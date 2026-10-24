/**
 * @fileoverview Pure planner: local tasks + links + GitHub state -> pull steps
 *
 * Each linked task is compared three ways. The base is the status at the last
 * sync (`link.lastPushedStatus`); a side has "changed" when it differs from it.
 */

import type { PullPlan, PullStep, RemoteIssue, SyncTask } from '../types.js';
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

		const from = task.status;
		// An imported issue says only open (pending) or closed. Push never
		// writes to it, so a local change can't conflict with it
		const to =
			link.imported && issue.state === 'open'
				? 'pending'
				: statusFromIssue(issue, link.lastPushedStatus);
		const step = { ...base, issueNumber: link.issueNumber, from, to };
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
