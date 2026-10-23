/**
 * @fileoverview Older status spellings
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
 * subtasks
 */
export function normalizeTaskStatuses(tasks: Task[]): Task[] {
	return tasks.map((task) =>
		isObject(task)
			? {
					...task,
					status: normalizeTaskStatus(task.status),
					...(Array.isArray(task.subtasks) && {
						subtasks: task.subtasks.map((subtask) =>
							isObject(subtask)
								? { ...subtask, status: normalizeTaskStatus(subtask.status) }
								: subtask
						)
					})
				}
			: task
	);
}

// A hand-edited file can hold null or other non-objects; leave them for
// validation to report instead of crashing here
const isObject = (value: unknown): boolean =>
	typeof value === 'object' && value !== null;
