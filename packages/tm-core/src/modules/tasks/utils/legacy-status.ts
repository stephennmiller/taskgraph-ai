/**
 * @fileoverview Older status spellings, subtask ID types and stale fields
 * Older task and archive files can say 'completed' where TaskGraph says
 * 'done', and store subtask IDs as numbers or dotted (`"3.2"`). Every loader
 * reads them as 'done' and the subtask's own number as a string, so the next
 * save writes those.
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
 * subtasks, each subtask's numeric `id` as a string (schema version 2, #748)
 * and a dotted one with its parent's prefix (`"3.2"` on task 3) as its own
 * number unless a sibling has that number (#805), and without the `tag` and
 * `parentTaskId` fields older versions wrote: a tag rename or a renumbering
 * move left them stale (#701, #702), and nothing reads them now
 */
export function normalizeTaskStatuses(tasks: Task[]): Task[] {
	return tasks.map((task) => {
		if (!isObject(task)) return task;
		const copy = current(task);
		if (Array.isArray(task.subtasks)) {
			const prefix = `${task.id}.`;
			const ids = task.subtasks.map((s) => (isObject(s) ? String(s.id) : ''));
			const bare = ids.map((id) => {
				const rest = id.startsWith(prefix) ? id.slice(prefix.length) : '';
				return /^\d+$/.test(rest) ? rest : id;
			});
			copy.subtasks = task.subtasks.map((subtask, i) => {
				if (!isObject(subtask)) return subtask;
				const migrated = current(subtask);
				if (typeof migrated.id === 'number') migrated.id = String(migrated.id);
				// Left dotted when a sibling already has that number, so two
				// subtasks never share an ID
				if (
					bare[i] !== ids[i] &&
					bare.indexOf(bare[i]) === bare.lastIndexOf(bare[i])
				) {
					migrated.id = bare[i];
				}
				return migrated;
			});
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
