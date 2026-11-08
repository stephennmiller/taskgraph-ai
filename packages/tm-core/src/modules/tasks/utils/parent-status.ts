/**
 * @fileoverview The status a parent task takes from its subtasks. Every
 * writer that changes a parent's subtasks (set-status on a subtask,
 * add-subtask, move, remove-subtask, expand) applies it, so a done parent
 * never hides open subtasks and finished subtasks never strand a parent
 * in progress (#1042).
 */

import { isTaskComplete } from '../../../common/constants/index.js';
import type { Task, TaskStatus } from '../../../common/types/index.js';
import { checkDoneGate } from './acceptance-criteria.js';
import { releaseClaimIfGivenUp } from './claim.js';

/** Refuses the move to done that finished subtasks would make, or undefined */
export type ParentDoneGuard = (parent: Task) => Error | undefined;

/** The done gate on the parent's own checklist (criteria, definition of done) */
export const parentDoneGate =
	(definitionOfDone: string[]): ParentDoneGuard =>
	(parent) =>
		checkDoneGate(parent, String(parent.id), definitionOfDone);

/**
 * `parent` with the status its subtasks give it; the same object when that
 * is its status already, otherwise with `updatedAt` stamped and a given-up
 * claim dropped.
 * - All complete, some done: done, unless `guardDone` refuses (in progress
 *   then) or the user put it in review.
 * - Some in progress or done: in progress.
 * - All pending: pending, only when `resetToPending` (a subtask set back).
 *   add-subtask or expand on a claimed parent keeps its claim.
 * - Otherwise a done parent with open subtasks reopens in progress.
 */
export function withParentStatus<T extends Task>(
	parent: T,
	guardDone?: ParentDoneGuard,
	resetToPending = false
): T {
	const subs = parent.subtasks ?? [];
	if (subs.length === 0) return parent;
	const norm = (s: { status?: TaskStatus }) => s.status || 'pending';
	let status = parent.status;
	if (subs.every((s) => isTaskComplete(norm(s)))) {
		// All cancelled: nothing was done, so the parent's own status stands
		if (subs.some((s) => norm(s) === 'done') && parent.status !== 'review') {
			const refusal =
				parent.status !== 'done' ? guardDone?.(parent) : undefined;
			status = refusal ? 'in-progress' : 'done';
		}
	} else if (subs.some((s) => ['in-progress', 'done'].includes(norm(s)))) {
		status = 'in-progress';
	} else if (resetToPending && subs.every((s) => norm(s) === 'pending')) {
		status = 'pending';
	} else if (parent.status === 'done') {
		status = 'in-progress';
	}
	if (status === parent.status) return parent;
	return releaseClaimIfGivenUp(
		{ ...parent, status, updatedAt: new Date().toISOString() },
		status
	);
}

/** Apply withParentStatus to each of these tasks in `tasks`, in place */
export function settleParentsIn(
	tasks: Task[],
	parentIds: Iterable<string | number>,
	guardDone?: ParentDoneGuard
): void {
	for (const id of new Set([...parentIds].map(String))) {
		const index = tasks.findIndex((t) => String(t.id) === id);
		if (index !== -1) tasks[index] = withParentStatus(tasks[index], guardDone);
	}
}
