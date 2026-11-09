/**
 * @fileoverview The status a parent task takes from its subtasks. FileStorage
 * applies it on every write that changes a parent's subtasks
 * (settleChangedParents), and set-status on a subtask after each ID, so a
 * done parent never hides open subtasks and finished subtasks never strand
 * a parent in progress (#1042, #1065).
 */

import {
	isTaskComplete,
	TASK_STATUS_MEANINGS
} from '../../../common/constants/index.js';
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
 * - All pending: pending, only when `subtaskStatusChanged` (a subtask set
 *   back). add-subtask or expand on a claimed parent keeps its claim.
 * - Otherwise a done parent with open subtasks reopens in progress.
 * Unless a subtask's own status changed, a parent the user put in review,
 * blocked, deferred or cancelled keeps that status.
 */
export function withParentStatus<T extends Task>(
	parent: T,
	guardDone?: ParentDoneGuard,
	subtaskStatusChanged = false
): T {
	const subs = parent.subtasks ?? [];
	if (subs.length === 0) return parent;
	const held =
		parent.status !== 'done' && !TASK_STATUS_MEANINGS[parent.status]?.pickable;
	if (held && !subtaskStatusChanged) return parent;
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
	} else if (subtaskStatusChanged && subs.every((s) => norm(s) === 'pending')) {
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

/** A task's subtask IDs, statuses and titles, to see what a write changed */
interface SubtaskShape {
	ids: string;
	statuses: string;
	titles: string;
}

/** Each task's SubtaskShape by ID, taken before a write changes `tasks` */
export function subtaskShapes(tasks: Task[]): Map<string, SubtaskShape> {
	return new Map(
		tasks.map((task) => {
			const subs = task.subtasks ?? [];
			return [
				String(task.id),
				{
					ids: JSON.stringify(subs.map((s) => String(s.id))),
					// Missing reads as pending, as withParentStatus reads it: a rewrite
					// that writes the default isn't a subtask's status change
					statuses: JSON.stringify(subs.map((s) => s.status || 'pending')),
					titles: JSON.stringify(subs.map((s) => s.title))
				}
			];
		})
	);
}

/**
 * The write funnel's step: each task in `tasks` that `before` had and whose
 * subtasks were added, removed or changed status takes the status they give
 * it (withParentStatus). Only a status change on the same subtasks counts as
 * `subtaskStatusChanged`: expand --force reuses IDs for new subtasks. A new
 * task (add-task, a move, a restore) keeps its status. Settled in place, so
 * a writer's result that holds the parent sees its new status.
 */
export function settleChangedParents(
	before: Map<string, SubtaskShape>,
	tasks: Task[],
	guardDone?: ParentDoneGuard
): void {
	const after = subtaskShapes(tasks);
	for (const task of tasks) {
		const was = before.get(String(task.id));
		const now = after.get(String(task.id)) as SubtaskShape;
		if (!was || (was.ids === now.ids && was.statuses === now.statuses)) {
			continue;
		}
		const statusOnly = was.ids === now.ids && was.titles === now.titles;
		const settled = withParentStatus(task, guardDone, statusOnly);
		if (settled === task) continue;
		// withParentStatus drops an emptied metadata key; Object.assign can't
		if (!('metadata' in settled)) delete task.metadata;
		Object.assign(task, settled);
	}
}
