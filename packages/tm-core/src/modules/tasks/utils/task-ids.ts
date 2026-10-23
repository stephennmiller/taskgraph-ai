/**
 * @fileoverview One shape for task IDs on the way out of @tm/core
 *
 * tasks.json stores task and subtask IDs as numbers or strings, and older
 * files leave a subtask's `parentId` out. Everything @tm/core hands to the
 * CLI and MCP gives IDs as strings, so `list`, `next` and `show` agree:
 *  - a task's `id` and `dependencies` are strings
 *  - a subtask's `id` is a string, and `parentId` is its task's ID
 *
 * A subtask's `dependencies` keep their stored type, since the type carries
 * the meaning (a bare number is a sibling; see resolveSubtaskDependency).
 */

import type { Task } from '../../../common/types/index.js';

/**
 * A task with string IDs throughout: its own `id`, its `dependencies`, and
 * each subtask's `id` and `parentId`. Every other field is kept as it is.
 */
export function normalizeTaskIds(task: Task): Task {
	return {
		...task,
		id: String(task.id),
		dependencies: (task.dependencies ?? []).map((dep) => String(dep)),
		subtasks: (task.subtasks ?? []).map((subtask) => ({
			...subtask,
			id: String(subtask.id),
			// Older files leave parentId out
			parentId: String(subtask.parentId ?? task.id)
		}))
	};
}
