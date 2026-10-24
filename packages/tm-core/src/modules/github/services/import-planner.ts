/**
 * @fileoverview Pure planner: open issues + local tasks -> import steps
 */

import type { ImportStep, RemoteIssue, SyncTask } from '../types.js';
import { parseMarker } from './issue-renderer.js';
import { getLink } from './sync-planner.js';

/** A task title that names its issue, as in `Fix login (#42)` */
const ISSUE_REF = /\(#(\d+)\)\s*$/;

export interface ImportPlanInput {
	repo: string;
	/** Tag new tasks go in; only its tasks are matched by title */
	tag: string;
	/** Open issues to import */
	issues: RemoteIssue[];
	/** Every local task, in every tag */
	tasks: SyncTask[];
}

export function planImport(input: ImportPlanInput): {
	steps: ImportStep[];
	skipped: number;
} {
	const linked = new Set<number>();
	for (const { task } of input.tasks) {
		const link = getLink(task, input.repo);
		if (link) linked.add(link.issueNumber);
	}
	// Unlinked tasks in the target tag that were added by hand for an issue
	const byRef = new Map<number, string>();
	for (const { tag, task } of input.tasks) {
		if (tag !== input.tag || task.metadata?.github) continue;
		const ref = ISSUE_REF.exec(task.title ?? '');
		if (ref) byRef.set(Number(ref[1]), String(task.id));
	}

	const steps: ImportStep[] = [];
	let skipped = 0;
	for (const issue of input.issues) {
		// A marker means push wrote the issue; push relinks it to its task
		if (linked.has(issue.number) || parseMarker(issue.body)) {
			skipped++;
			continue;
		}
		const base = {
			issueNumber: issue.number,
			title: issue.title,
			url: issue.url
		};
		const taskId = byRef.get(issue.number);
		steps.push(
			taskId
				? { ...base, action: 'link', taskId }
				: { ...base, action: 'create' }
		);
	}
	return { steps, skipped };
}
