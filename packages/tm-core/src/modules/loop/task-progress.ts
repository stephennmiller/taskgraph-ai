/**
 * @fileoverview What a loop run counts as progress: a task is completed when
 * its status moves to done or review, not when Claude Code exits 0 (#812)
 */

import type { Task, TaskStatus } from '../../common/types/index.js';

/** Whether a task in this status counts as completed by the loop */
export const isFinishedStatus = (status: TaskStatus | undefined): boolean =>
	status === 'done' || status === 'review';

/** Each task's and subtask's status, keyed `3` and `3.2` */
export function taskStatuses(tasks: Task[]): Map<string, TaskStatus> {
	const statuses = new Map<string, TaskStatus>();
	for (const task of tasks) {
		statuses.set(String(task.id), task.status);
		for (const sub of task.subtasks ?? []) {
			statuses.set(`${task.id}.${sub.id}`, sub.status);
		}
	}
	return statuses;
}

/**
 * Between two snapshots: how many tasks moved to done or review, and
 * whether any status changed at all
 */
export function statusProgress(
	before: Map<string, TaskStatus>,
	after: Map<string, TaskStatus>
): { finished: number; changed: boolean } {
	let finished = 0;
	let changed = before.size !== after.size;
	for (const [id, status] of after) {
		const was = before.get(id);
		if (was === status) continue;
		changed = true;
		if (was !== undefined && isFinishedStatus(status) && !isFinishedStatus(was))
			finished++;
	}
	return { finished, changed };
}
