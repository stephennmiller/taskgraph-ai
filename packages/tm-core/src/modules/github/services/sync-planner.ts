/**
 * @fileoverview Pure planner: local tasks + links + GitHub state -> steps
 */

import type { Task } from '../../../common/types/index.js';
import type {
	GitHubLink,
	OrphanIssue,
	PlanStep,
	PushPlan,
	RemoteIssue,
	SyncTask
} from '../types.js';
import { hashIssue, parseMarker, renderIssue } from './issue-renderer.js';

export interface PlanInput {
	repo: string;
	tasks: SyncTask[];
	/** Issues carrying the taskgraph label, open and closed */
	remote: RemoteIssue[];
	includeDetails?: boolean;
	closeOrphans?: boolean;
	/** Tags being pushed; orphans from other tags are left alone */
	scopeTags?: string[];
}

const keyOf = (tag: string, id: string) => `${tag}\u0000${id}`;

/** The stored link, if it points at the repo being pushed to */
export function getLink(task: Task, repo: string): GitHubLink | undefined {
	const link = task.metadata?.github as GitHubLink | undefined;
	if (!link || typeof link.issueNumber !== 'number') return undefined;
	return link.repo === repo ? link : undefined;
}

export function planSync(input: PlanInput): PushPlan {
	const { repo, tasks, remote } = input;

	const byMarker = new Map<string, RemoteIssue>();
	for (const issue of remote) {
		const marker = parseMarker(issue.body);
		if (marker) byMarker.set(keyOf(marker.tag, marker.id), issue);
	}

	// Pass 1: decide where each task's issue is (metadata, marker, or none)
	const numbers = new Map<string, Map<string, number>>();
	const claimed = new Set<number>();
	const found = tasks.map(({ tag, task }) => {
		const id = String(task.id);
		const link = getLink(task, repo);
		const recovered = link ? undefined : byMarker.get(keyOf(tag, id));
		const number = link?.issueNumber ?? recovered?.number;
		if (number !== undefined) {
			claimed.add(number);
			if (!numbers.has(tag)) numbers.set(tag, new Map());
			numbers.get(tag)?.set(id, number);
		}
		return { tag, task, link, recovered, number };
	});

	const creating = new Set(
		found
			.filter((f) => f.number === undefined)
			.map((f) => keyOf(f.tag, String(f.task.id)))
	);

	// Pass 2: one step per task
	const steps: PlanStep[] = found.map(
		({ tag, task, link, recovered, number }) => {
			const base = { tag, taskId: String(task.id), title: task.title };
			if (number === undefined) return { ...base, action: 'create' };
			if (!link) {
				return {
					...base,
					action: 'update',
					issueNumber: number,
					recovered: true,
					url: recovered?.url,
					reason: 'link recovered from issue marker'
				};
			}
			const rendered = renderIssue(task, {
				tag,
				includeDetails: input.includeDetails,
				issueNumbers: numbers.get(tag)
			});
			if (hashIssue(rendered) !== link.bodyHash) {
				return {
					...base,
					action: 'update',
					issueNumber: number,
					reason: 'content changed'
				};
			}
			const waitsOnNew = (task.dependencies ?? []).some((dep) =>
				creating.has(keyOf(tag, String(dep)))
			);
			if (waitsOnNew) {
				return {
					...base,
					action: 'update',
					issueNumber: number,
					reason: 'dependency issue not created yet'
				};
			}
			return { ...base, action: 'skip', issueNumber: number };
		}
	);

	// Orphans: open issues with a marker that no local task claims
	const scope = input.scopeTags ? new Set(input.scopeTags) : undefined;
	const orphans: OrphanIssue[] = [];
	for (const issue of remote) {
		if (issue.state !== 'open' || claimed.has(issue.number)) continue;
		const marker = parseMarker(issue.body);
		if (!marker || (scope && !scope.has(marker.tag))) continue;
		orphans.push({
			issueNumber: issue.number,
			url: issue.url,
			title: issue.title,
			tag: marker.tag,
			taskId: marker.id
		});
	}

	if (input.closeOrphans) {
		for (const orphan of orphans) {
			steps.push({
				action: 'close',
				tag: orphan.tag ?? '',
				taskId: orphan.taskId ?? '',
				title: orphan.title,
				issueNumber: orphan.issueNumber,
				reason: 'task no longer exists locally'
			});
		}
	}

	return { repo, steps, orphans };
}
