/**
 * @fileoverview GitHubDomain - one-way push of tasks to GitHub Issues
 */

import {
	ERROR_CODES,
	TaskGraphError
} from '../../common/errors/taskgraph-error.js';
import {
	getGitHubRepoInfo,
	isGhCliAvailable
} from '../../common/utils/git-utils.js';
import type { TasksDomain } from '../tasks/tasks-domain.js';
import { parseTaskIds } from '../tasks/validation/task-id.js';
import type { GitHubClient } from './adapters/github-client.interface.js';
import { GhCliClient } from './adapters/gh-cli-client.js';
import { BASE_LABEL } from './services/issue-renderer.js';
import { executePush } from './services/push-executor.js';
import { planPull } from './services/pull-planner.js';
import { getLink, planSync } from './services/sync-planner.js';
import type {
	GitHubLink,
	GitHubStatus,
	PullOptions,
	PullPlan,
	PullResult,
	PullStep,
	PushOptions,
	PushPlan,
	PushResult,
	SyncTask,
	UnlinkResult
} from './types.js';

/** The options push and pull share for choosing repo, tags and tasks */
type ScopeOptions = Pick<PushOptions, 'repo' | 'tag' | 'allTags' | 'taskIds'>;

export interface GitHubDomainOptions {
	/** Build a client for `owner/name`; defaults to the `gh` CLI client */
	clientFactory?: (repo: string) => GitHubClient;
	/** Tag pushed when a push names none; without it every tag is pushed */
	getActiveTag?: () => string;
	sleep?: (ms: number) => Promise<void>;
	now?: () => Date;
}

export class GitHubDomain {
	private tasksDomain?: TasksDomain;

	constructor(
		private readonly projectRoot: string,
		private readonly options: GitHubDomainOptions = {}
	) {}

	/** Wired by TmCore after the tasks domain is initialized */
	setTasksDomain(tasks: TasksDomain): void {
		this.tasksDomain = tasks;
	}

	/** Is `gh` usable, which repo would be used, and how many tasks are linked */
	async status(options: { repo?: string } = {}): Promise<GitHubStatus> {
		const ghAvailable = await isGhCliAvailable(this.projectRoot);
		let repo: string | null = options.repo ?? null;
		if (!repo && ghAvailable) {
			repo = await this.detectRepo();
		}
		const tasks = await this.loadTasks();
		const linkedTasks = tasks.filter((t) => t.task.metadata?.github).length;
		return {
			ghAvailable,
			repo,
			linkedTasks,
			unlinkedTasks: tasks.length - linkedTasks
		};
	}

	/** Work out what a push would do, without writing anything */
	async planPush(options: PushOptions = {}): Promise<PushPlan> {
		const { plan } = await this.prepare(options);
		return plan;
	}

	async push(options: PushOptions = {}): Promise<PushResult> {
		const { plan, client, tasks } = await this.prepare(options);
		const counts = { created: 0, updated: 0, skipped: 0, closed: 0 };

		if (options.dryRun) {
			for (const step of plan.steps) {
				const key = (
					{
						create: 'created',
						update: 'updated',
						skip: 'skipped',
						close: 'closed'
					} as const
				)[step.action];
				counts[key]++;
			}
			return { dryRun: true, plan, ...counts, orphans: plan.orphans };
		}

		const done = await executePush(plan, tasks, {
			client,
			tasks: this.requireTasks(),
			includeDetails: options.includeDetails,
			delayMs: options.delayMs,
			sleep: this.options.sleep,
			now: this.options.now
		});
		return { dryRun: false, plan, ...done, orphans: plan.orphans };
	}

	/** Work out which task statuses a pull would change, without writing anything */
	async planPull(options: PullOptions = {}): Promise<PullPlan> {
		const { plan } = await this.preparePull(options);
		return plan;
	}

	/**
	 * Bring task statuses in line with their issues. Writes only to local
	 * tasks, never to GitHub. A task that changed on both sides is left alone.
	 */
	async pull(options: PullOptions = {}): Promise<PullResult> {
		const { plan, tasks } = await this.preparePull(options);
		const counts = { applied: 0, synced: 0, conflicts: 0, skipped: 0 };
		const byKey = new Map(
			tasks.map((t) => [`${t.tag}\u0000${t.task.id}`, t] as const)
		);
		for (const step of plan.steps) {
			if (step.action === 'conflict') counts.conflicts++;
			else if (step.action === 'skip') counts.skipped++;
			else {
				const target = byKey.get(`${step.tag}\u0000${step.taskId}`);
				if (!options.dryRun && target) {
					await this.recordPull(plan.repo, step, target);
				}
				if (step.action === 'apply') counts.applied++;
				else counts.synced++;
			}
		}
		return { dryRun: Boolean(options.dryRun), plan, ...counts };
	}

	/**
	 * Forget the issue a task is linked to. The issue itself is left alone.
	 * Without a tag the task id must be linked in exactly one tag.
	 */
	async unlink(
		taskId: string,
		options: { tag?: string } = {}
	): Promise<UnlinkResult> {
		const id = String(taskId);
		const candidates = (await this.loadTasks(options.tag)).filter(
			(t) => String(t.task.id) === id
		);
		if (candidates.length === 0) {
			throw new TaskGraphError(
				`Task ${id} not found${options.tag ? ` in tag ${options.tag}` : ''}`,
				ERROR_CODES.TASK_NOT_FOUND
			);
		}
		const linked = candidates.filter((t) => t.task.metadata?.github);
		if (linked.length === 0) {
			throw new TaskGraphError(
				`Task ${id} is not linked to a GitHub issue`,
				ERROR_CODES.VALIDATION_ERROR
			);
		}
		if (linked.length > 1) {
			throw new TaskGraphError(
				`Task ${id} is linked in several tags (${linked.map((t) => t.tag).join(', ')}); pass --tag to choose one`,
				ERROR_CODES.VALIDATION_ERROR
			);
		}
		const { tag, task } = linked[0];
		const { github, ...rest } = task.metadata as Record<string, unknown>;
		const link = github as GitHubLink;
		await this.requireTasks().update(task.id, { metadata: rest }, tag);
		return {
			tag,
			taskId: id,
			issueNumber: link.issueNumber,
			url: link.url
		};
	}

	/** Repo, client, the tasks in scope and the issues on GitHub, for push and pull */
	private async scope(options: ScopeOptions) {
		const repo = options.repo ?? (await this.detectRepo());
		if (!repo) {
			throw new TaskGraphError(
				'Could not determine the GitHub repository. Pass a repo as owner/name or run `gh auth login` in a GitHub checkout.',
				ERROR_CODES.MISSING_CONFIGURATION
			);
		}
		const client = this.options.clientFactory
			? this.options.clientFactory(repo)
			: new GhCliClient(repo, { cwd: this.projectRoot });
		const tag = this.resolveTag(options);
		const tasks = await this.loadTasks(tag);
		const remote = await client.listIssues(BASE_LABEL);
		const wanted = this.resolveTaskIds(options.taskIds);
		if (wanted) {
			const known = new Set(tasks.map((t) => String(t.task.id)));
			const missing = wanted.filter((id) => !known.has(id));
			if (missing.length > 0) {
				throw new TaskGraphError(
					`Task ${missing.join(', ')} not found`,
					ERROR_CODES.TASK_NOT_FOUND
				);
			}
		}
		return { repo, client, tag, tasks, remote, wanted };
	}

	private async prepare(options: PushOptions) {
		const { repo, client, tag, tasks, remote, wanted } =
			await this.scope(options);
		const full = planSync({
			repo,
			tasks,
			remote,
			includeDetails: options.includeDetails,
			closeOrphans: options.closeOrphans,
			scopeTags: tag ? [tag] : undefined
		});
		// Plan against every task so unselected ones are not mistaken for
		// orphans, then keep only the selected steps
		const plan = wanted
			? {
					...full,
					steps: full.steps.filter(
						(s) => s.action === 'close' || wanted.includes(s.taskId)
					)
				}
			: full;
		return { plan, client, tasks };
	}

	private async preparePull(options: PullOptions) {
		const { repo, tasks, remote, wanted } = await this.scope(options);
		const selected = wanted
			? tasks.filter((t) => wanted.includes(String(t.task.id)))
			: tasks;
		return {
			plan: planPull({ repo, tasks: selected, remote }),
			tasks: selected
		};
	}

	/** Set the task's status if the issue won, and move the link's base to it */
	private async recordPull(
		repo: string,
		step: PullStep,
		{ task }: SyncTask
	): Promise<void> {
		const link = getLink(task, repo);
		if (!link || !step.to) return;
		const tasksDomain = this.requireTasks();
		if (step.action === 'apply') {
			await tasksDomain.updateStatus(step.taskId, step.to, step.tag);
		}
		const github: GitHubLink = {
			...link,
			lastPushedStatus: step.to,
			syncedAt: (this.options.now?.() ?? new Date()).toISOString()
		};
		await tasksDomain.update(
			task.id,
			{ metadata: { ...task.metadata, github } },
			step.tag
		);
	}

	/** The one tag a push covers, or undefined for every tag */
	private resolveTag(options: ScopeOptions): string | undefined {
		if (options.tag && options.allTags) {
			throw new TaskGraphError(
				'Use either tag or allTags, not both',
				ERROR_CODES.VALIDATION_ERROR
			);
		}
		if (options.allTags) return undefined;
		return options.tag ?? this.options.getActiveTag?.();
	}

	private resolveTaskIds(
		taskIds: PushOptions['taskIds']
	): string[] | undefined {
		if (taskIds === undefined) return undefined;
		if (Array.isArray(taskIds)) return taskIds.map(String);
		try {
			return parseTaskIds(taskIds);
		} catch (error) {
			throw new TaskGraphError(
				error instanceof Error ? error.message : String(error),
				ERROR_CODES.VALIDATION_ERROR
			);
		}
	}

	private async detectRepo(): Promise<string | null> {
		const info = await getGitHubRepoInfo(this.projectRoot);
		return info ? `${info.owner.login}/${info.name}` : null;
	}

	private requireTasks(): TasksDomain {
		if (!this.tasksDomain) {
			throw new TaskGraphError(
				'GitHubDomain is not wired to the tasks domain',
				ERROR_CODES.INTERNAL_ERROR
			);
		}
		return this.tasksDomain;
	}

	private async loadTasks(tag?: string): Promise<SyncTask[]> {
		const tasksDomain = this.requireTasks();
		const tags = tag
			? [tag]
			: (await tasksDomain.getTagsWithStats()).tags.map((t) => t.name);
		const result: SyncTask[] = [];
		for (const name of tags) {
			const { tasks } = await tasksDomain.list({
				tag: name,
				includeSubtasks: true
			});
			for (const task of tasks) result.push({ tag: name, task });
		}
		return result;
	}
}
