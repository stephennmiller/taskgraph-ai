/**
 * @fileoverview One shape for task IDs on the way out of @tm/core
 *
 * tasks.json stores task and subtask IDs as numbers or strings, and older
 * files leave a subtask's `parentId` out. Everything @tm/core hands to the
 * CLI and MCP gives IDs as strings:
 *  - a task's `id` and `dependencies` are strings
 *  - a subtask's `id` is a string, and `parentId` is its task's ID
 *
 * Inside @tm/core a nested subtask's `id` stays its own number (`"1"`), which
 * lookups and renderers join to the parent's. JSON replies give the full
 * dotted ID (`"9.1"`) instead, through withFullSubtaskIds, so `show`, `list`
 * and `next` agree.
 *
 * A subtask's `dependencies` keep their stored type inside @tm/core, since
 * the type carries the meaning (a bare number is a sibling; see
 * resolveSubtaskDependency). JSON replies give them as full IDs too.
 */

import type { Task } from '../../../common/types/index.js';
import { resolveSubtaskDependency } from '../../dependencies/subtask-dependency.js';
import { fullSubtaskId } from '../validation/task-id.js';

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

/**
 * The task as a JSON reply gives it: each subtask's `id` and `dependencies`
 * are full dotted IDs (`"9.1"`), the form `show`, `set-status` and `next` take. Never save the
 * result; tasks.json keeps the subtask's own number. Null stays null.
 */
export function withFullSubtaskIds<T extends { id: string | number } | null>(
	task: T
): T {
	const subtasks = (task as Partial<Task> | null)?.subtasks;
	if (!task || !Array.isArray(subtasks)) return task;
	return {
		...task,
		subtasks: subtasks.map((subtask) => ({
			...subtask,
			id: fullSubtaskId(task.id, subtask.id),
			...(subtask.dependencies && {
				dependencies: subtask.dependencies.map((dep: string | number) =>
					resolveSubtaskDependency(task.id, dep)
				)
			})
		}))
	};
}
