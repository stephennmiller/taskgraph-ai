/**
 * @fileoverview Pure planner: local tasks + links + GitHub state -> pull steps
 *
 * Each linked task is compared three ways. The base is the status at the last
 * sync (`link.lastPushedStatus`); a side has "changed" when it differs from it.
 */

import type { Task } from '../../../common/types/index.js';
import type {
	GitHubLink,
	PullPlan,
	PullStep,
	RemoteIssue,
	SyncTask
} from '../types.js';
import { sameStatus, statusFromIssue } from './issue-status.js';
import { getLink } from './sync-planner.js';

export interface PullPlanInput {
	repo: string;
	tasks: SyncTask[];
	/** Issues carrying the taskgraph label, open and closed, plus imported ones */
	remote: RemoteIssue[];
}

export function planPull(input: PullPlanInput): PullPlan {
	const byNumber = new Map(input.remote.map((issue) => [issue.number, issue]));

	const steps = input.tasks.map(({ tag, task }): PullStep => {
		const base = { tag, taskId: String(task.id), title: task.title };
		const link = getLink(task, input.repo);
		if (!link) {
			return {
				...base,
				action: 'skip',
				reason: 'not linked, push first'
			};
		}
		const issue = byNumber.get(link.issueNumber);
		if (!issue) {
			return {
				...base,
				action: 'skip',
				issueNumber: link.issueNumber,
				reason: 'issue not found on GitHub'
			};
		}

		const assignTo = assigneeFromIssue(task, link, issue);
		const from = task.status;
		// An imported issue says only open (pending) or closed. Push never
		// writes to it, so a local change can't conflict with it
		const to =
			link.imported && issue.state === 'open'
				? 'pending'
				: statusFromIssue(issue, link.lastPushedStatus);
		const step = {
			...base,
			issueNumber: link.issueNumber,
			from,
			to,
			...(assignTo !== undefined && { assignTo })
		};
		const localChanged =
			!link.imported && !sameStatus(from, link.lastPushedStatus);
		const remoteChanged = !sameStatus(to, link.lastPushedStatus);

		if (!remoteChanged) {
			return {
				...step,
				action: 'skip',
				reason: localChanged
					? 'changed locally, push to update GitHub'
					: 'unchanged'
			};
		}
		if (sameStatus(from, to)) {
			return { ...step, action: 'sync', reason: 'already in sync' };
		}
		if (!localChanged) return { ...step, action: 'apply' };
		return {
			...step,
			action: 'conflict',
			reason: 'changed on both sides, the local status is kept'
		};
	});

	return { repo: input.repo, steps };
}

/** The issue's assignee as the task would hold it: the task's own if it is among them */
function issueAssignee(task: Task, issue: RemoteIssue): string | undefined {
	const local = task.assignee;
	return local && issue.assignees.includes(local) ? local : issue.assignees[0];
}

/**
 * The assignee a pull gives the task: the issue's, when it changed on GitHub
 * since the last sync and not locally, or when both sides already agree
 * (then only the link's base moves). A login, null for nobody, or undefined
 * to leave the task alone (unchanged on GitHub, or changed on both sides,
 * where the local one is kept)
 */
function assigneeFromIssue(
	task: Task,
	link: GitHubLink,
	issue: RemoteIssue
): string | null | undefined {
	const remote = issueAssignee(task, issue);
	if (remote === link.assignee) return undefined;
	// Both sides agree already: only the base moves
	if (remote === task.assignee) return remote ?? null;
	if (task.assignee !== link.assignee) return undefined;
	return remote ?? null;
}
