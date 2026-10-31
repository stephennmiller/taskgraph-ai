/**
 * @fileoverview Runs a push plan against GitHub.
 *
 * Writes are sequential with a short pause. The link for a new issue is saved
 * to the task right after the issue is created, so a crash never loses it (and
 * if even that save fails, the hidden marker lets the next run find the issue).
 */

import type { TasksDomain } from '../../tasks/tasks-domain.js';
import { assigneeOf } from '../../tasks/utils/assignee.js';
import type { GitHubClient } from '../adapters/github-client.interface.js';
import {
	ERROR_CODES,
	errorWithHint
} from '../../../common/errors/taskgraph-error.js';
import { stripTerminalControls } from '../../../common/utils/terminal-text.js';
import type {
	GitHubLink,
	PlanStep,
	PushPlan,
	RemoteIssue,
	RenderedIssue,
	SyncTask
} from '../types.js';
import { BASE_LABEL, hashIssue, renderIssue } from './issue-renderer.js';
import { getLink } from './sync-planner.js';

/** The slice of TasksDomain the executor needs */
type TaskWriter = Pick<TasksDomain, 'modifyTask'>;

export interface ExecutorDeps {
	client: GitHubClient;
	tasks: TaskWriter;
	includeDetails?: boolean;
	delayMs?: number;
	sleep?: (ms: number) => Promise<void>;
	now?: () => Date;
}

export interface ExecutionCounts {
	created: number;
	updated: number;
	skipped: number;
	closed: number;
}

const defaultSleep = (ms: number) =>
	new Promise<void>((resolve) => setTimeout(resolve, ms));

/** What GitHub holds right after an issue is created: open, no state reason */
const asCreated = (issue: RenderedIssue): RenderedIssue => ({
	...issue,
	state: 'open',
	stateReason: undefined
});

export async function executePush(
	plan: PushPlan,
	tasks: SyncTask[],
	deps: ExecutorDeps
): Promise<ExecutionCounts> {
	const { client } = deps;
	const repo = plan.repo;
	const sleep = deps.sleep ?? defaultSleep;
	const now = deps.now ?? (() => new Date());
	const delayMs = deps.delayMs ?? 400;
	const counts: ExecutionCounts = {
		created: 0,
		updated: 0,
		skipped: 0,
		closed: 0
	};

	const byKey = new Map(
		tasks.map((t) => [`${t.tag}\u0000${t.task.id}`, t] as const)
	);
	const find = (step: PlanStep) => byKey.get(`${step.tag}\u0000${step.taskId}`);

	// Issue numbers known so far, per tag
	const numbers = new Map<string, Map<string, number>>();
	const setNumber = (tag: string, id: string, n: number) => {
		if (!numbers.has(tag)) numbers.set(tag, new Map());
		numbers.get(tag)?.set(id, n);
	};
	for (const { tag, task } of tasks) {
		const link = getLink(task, repo);
		if (link) setNumber(tag, String(task.id), link.issueNumber);
	}

	const render = ({ tag, task }: SyncTask) =>
		renderIssue(task, {
			tag,
			includeDetails: deps.includeDetails,
			issueNumbers: numbers.get(tag)
		});

	/** `assignee` is what GitHub now holds, as far as the push knows */
	const saveLink = async (
		{ tag, task }: SyncTask,
		issueNumber: number,
		url: string,
		bodyHash: string,
		assignee: string | undefined
	) => {
		const link: GitHubLink = {
			repo,
			issueNumber,
			url,
			syncedAt: now().toISOString(),
			lastPushedStatus: task.status,
			bodyHash,
			...(assignee && { assignee })
		};
		// Read metadata under the lock: a claim made during the push stays
		const saved = await deps.tasks.modifyTask(
			task.id,
			(current) => ({ metadata: { ...current.metadata, github: link } }),
			tag
		);
		task.metadata = saved.metadata;
	};

	let wrote = false;
	const pace = async () => {
		if (wrote && delayMs > 0) await sleep(delayMs);
		wrote = true;
	};

	/**
	 * Move the issue from the last synced assignee to the task's, leaving
	 * anyone else assigned on GitHub alone. The add goes first: GitHub
	 * ignores a login it can't assign without an error, and the old
	 * assignee stays until the new one has taken
	 * @returns The new base: the task's assignee if GitHub kept it
	 */
	const reassignIssue = async (
		number: number,
		base: string | undefined,
		assignee: string | undefined,
		{ taskId }: { taskId: string }
	): Promise<string | undefined> => {
		let issue: RemoteIssue | undefined;
		if (assignee) {
			await pace();
			issue = await withAssigneeHint(
				() => client.changeAssignees(number, 'add', [assignee]),
				{ assignee, repo, taskId }
			);
			if (!heldBy(issue, assignee)) {
				throw errorWithHint(
					ERROR_CODES.API_ERROR,
					`GitHub did not assign ${stripTerminalControls(assignee)} to issue #${number}`,
					assigneeHint(assignee, repo, taskId)
				);
			}
		}
		if (base && base !== assignee) {
			await pace();
			issue = await client.changeAssignees(number, 'remove', [base]);
		}
		return issue ? heldBy(issue, assignee) : undefined;
	};

	const pending = plan.steps.filter(
		(s) => s.action === 'create' || s.action === 'update'
	);
	for (const step of plan.steps) {
		if (step.action === 'skip') counts.skipped++;
	}

	// Recovered links are saved straight away; their body is refreshed below
	for (const step of pending.filter((s) => s.recovered)) {
		const target = find(step);
		if (!target || step.issueNumber === undefined) continue;
		setNumber(step.tag, step.taskId, step.issueNumber);
		// GitHub's assignee is unknown here: no base, so pass 2 writes the task's
		await saveLink(target, step.issueNumber, step.url ?? '', '', undefined);
	}

	const labels = new Set<string>([BASE_LABEL]);
	for (const step of pending) {
		const target = find(step);
		if (target) for (const l of render(target).labels) labels.add(l);
	}
	if (pending.length > 0) await client.ensureLabels([...labels]);

	// Pass 1: create missing issues so every task has a number
	for (const step of pending.filter((s) => s.action === 'create')) {
		const target = find(step);
		if (!target) continue;
		const rendered = render(target);
		const assignee = assigneeOf(target.task);
		await pace();
		const issue = await withAssigneeHint(
			() =>
				client.createIssue({
					title: rendered.title,
					body: rendered.body,
					labels: rendered.labels,
					...(assignee && { assignees: [assignee] })
				}),
			{ assignee, repo, taskId: step.taskId }
		);
		setNumber(step.tag, step.taskId, issue.number);
		await saveLink(
			target,
			issue.number,
			issue.url,
			hashIssue(asCreated(rendered)),
			heldBy(issue, assignee)
		);
		counts.created++;
	}

	// Pass 2: now that all numbers exist, bring bodies and state up to date
	for (const step of pending) {
		const target = find(step);
		if (!target) continue;
		const link = getLink(target.task, repo);
		if (!link) continue;
		const rendered = render(target);
		const hash = hashIssue(rendered);
		const assignee = assigneeOf(target.task);
		const reassign = assignee !== link.assignee;
		if (hash === link.bodyHash && !reassign) continue;
		let base = link.assignee;
		if (hash !== link.bodyHash) {
			await pace();
			await client.updateIssue(link.issueNumber, {
				title: rendered.title,
				body: rendered.body,
				labels: rendered.labels,
				state: rendered.state,
				stateReason: rendered.stateReason
			});
		}
		if (reassign) {
			base = await reassignIssue(link.issueNumber, link.assignee, assignee, {
				taskId: step.taskId
			});
		}
		await saveLink(target, link.issueNumber, link.url, hash, base);
		if (step.action === 'update') counts.updated++;
	}

	for (const step of plan.steps.filter((s) => s.action === 'close')) {
		if (step.issueNumber === undefined) continue;
		await pace();
		await client.updateIssue(step.issueNumber, {
			state: 'closed',
			stateReason: 'not_planned'
		});
		counts.closed++;
	}

	return counts;
}

/**
 * The base after a write that sent `assignee`: it, if GitHub kept it.
 * Without push access GitHub drops assignees silently, and a base naming
 * someone else would have the next push remove them
 */
function heldBy(
	issue: RemoteIssue,
	assignee: string | undefined
): string | undefined {
	return assignee && issue.assignees.includes(assignee) ? assignee : undefined;
}

/**
 * Run a GitHub write that sets `assignee`; GitHub refuses (422) a login that
 * can't be assigned in the repo, so say how to fix that
 */
async function withAssigneeHint<T>(
	write: () => Promise<T>,
	{
		assignee,
		repo,
		taskId
	}: { assignee: string | undefined; repo: string; taskId: string }
): Promise<T> {
	try {
		return await write();
	} catch (error) {
		if (
			!assignee ||
			!(error instanceof Error) ||
			!/\(422\)/.test(error.message)
		) {
			throw error;
		}
		throw Object.assign(error, {
			hint: assigneeHint(assignee, repo, taskId)
		});
	}
}

function assigneeHint(assignee: string, repo: string, taskId: string) {
	return `Only collaborators on ${repo} can be assigned. Add ${stripTerminalControls(assignee)} as a collaborator, or change it with \`taskgraph update-task ${taskId} --assignee <login>\``;
}
