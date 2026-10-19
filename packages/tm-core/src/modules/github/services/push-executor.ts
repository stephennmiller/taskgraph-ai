/**
 * @fileoverview Runs a push plan against GitHub.
 *
 * Writes are sequential with a short pause. The link for a new issue is saved
 * to the task right after the issue is created, so a crash never loses it (and
 * if even that save fails, the hidden marker lets the next run find the issue).
 */

import type { Task } from '../../../common/types/index.js';
import type { GitHubClient } from '../adapters/github-client.interface.js';
import type {
	GitHubLink,
	PlanStep,
	PushPlan,
	RenderedIssue,
	SyncTask
} from '../types.js';
import { BASE_LABEL, hashIssue, renderIssue } from './issue-renderer.js';
import { getLink } from './sync-planner.js';

/** The slice of TasksDomain the executor needs */
export interface TaskWriter {
	update(
		taskId: string | number,
		updates: Partial<Task>,
		tag?: string
	): Promise<void>;
}

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

	const saveLink = async (
		{ tag, task }: SyncTask,
		issueNumber: number,
		url: string,
		bodyHash: string
	) => {
		const link: GitHubLink = {
			repo,
			issueNumber,
			url,
			syncedAt: now().toISOString(),
			lastPushedStatus: task.status,
			bodyHash
		};
		const metadata = { ...task.metadata, github: link };
		await deps.tasks.update(task.id, { metadata }, tag);
		task.metadata = metadata;
	};

	let wrote = false;
	const pace = async () => {
		if (wrote && delayMs > 0) await sleep(delayMs);
		wrote = true;
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
		await saveLink(target, step.issueNumber, step.url ?? '', '');
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
		await pace();
		const issue = await client.createIssue({
			title: rendered.title,
			body: rendered.body,
			labels: rendered.labels
		});
		setNumber(step.tag, step.taskId, issue.number);
		await saveLink(
			target,
			issue.number,
			issue.url,
			hashIssue(asCreated(rendered))
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
		if (hash === link.bodyHash) continue;
		await pace();
		await client.updateIssue(link.issueNumber, {
			title: rendered.title,
			body: rendered.body,
			labels: rendered.labels,
			state: rendered.state,
			stateReason: rendered.stateReason
		});
		await saveLink(target, link.issueNumber, link.url, hash);
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
