/**
 * @fileoverview Older status spellings and stale fields
 * Older task and archive files can say 'completed' where TaskGraph says
 * 'done'. Every loader reads it as 'done', so the next save writes 'done'.
 */

import type { Task } from '../../../common/types/index.js';

/**
 * Reads the older 'completed' spelling as 'done'. Any other value is
 * returned unchanged, so a missing or unknown status still fails validation
 * where it did before.
 */
export function normalizeTaskStatus<T extends string | undefined>(
	status: T
): T | 'done' {
	return status === 'completed' ? 'done' : status;
}

/**
 * Copies of the tasks with 'completed' read as 'done', on tasks and their
 * subtasks, and without the `tag` and `parentTaskId` fields older versions
 * wrote: a tag rename or a renumbering move left them stale (#701, #702), and
 * nothing reads them now
 */
export function normalizeTaskStatuses(tasks: Task[]): Task[] {
	return tasks.map((task) => {
		if (!isObject(task)) return task;
		const copy = current(task);
		if (Array.isArray(task.subtasks)) {
			copy.subtasks = task.subtasks.map((subtask) =>
				isObject(subtask) ? current(subtask) : subtask
			);
		}
		return copy;
	});
}

function current<T extends { status?: string }>(item: T): T {
	const copy: T & { tag?: unknown; parentTaskId?: unknown } = {
		...item,
		status: normalizeTaskStatus(item.status)
	};
	delete copy.tag;
	delete copy.parentTaskId;
	return copy;
}

// A hand-edited file can hold null or other non-objects; leave them for
// validation to report instead of crashing here
const isObject = (value: unknown): boolean =>
	typeof value === 'object' && value !== null;
