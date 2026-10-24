/**
 * @fileoverview Pick which fields of each task a listing returns
 * Agents read task lists through MCP, where every field costs tokens, so a
 * listing returns a few fields by default and more only when asked.
 */

import {
	ERROR_CODES,
	TaskGraphError
} from '../../../common/errors/taskgraph-error.js';
import type { Task } from '../../../common/types/index.js';

/** The fields a task listing returns when none are asked for */
export const DEFAULT_TASK_FIELDS = [
	'id',
	'title',
	'status',
	'priority',
	'dependencies'
] as const satisfies readonly (keyof Task)[];

/** Every task field a listing can return */
export const TASK_FIELDS = [
	'id',
	'title',
	'description',
	'status',
	'priority',
	'dependencies',
	'details',
	'testStrategy',
	'subtasks',
	'createdAt',
	'updatedAt',
	'effort',
	'actualEffort',
	'tags',
	'assignee',
	'acceptanceCriteria',
	'definitionOfDoneChecked',
	'relevantFiles',
	'codebasePatterns',
	'existingInfrastructure',
	'scopeBoundaries',
	'implementationApproach',
	'technicalConstraints',
	'skills',
	'category',
	'databaseId',
	'complexity',
	'recommendedSubtasks',
	'expansionPrompt',
	'complexityReasoning',
	'metadata'
] as const satisfies readonly (keyof Task)[];

export type TaskField = (typeof TASK_FIELDS)[number];

/**
 * Read a comma-separated field list such as `"title,details"`.
 * `id` is always returned. Empty or missing gives the default fields, and
 * `all` gives every field. `withSubtasks: true` adds `subtasks`, and
 * `withSubtasks: false` drops it (the listing then has none to return).
 * @returns The fields to keep, or `'all'` to keep each task whole
 * @throws TaskGraphError naming the valid fields when one isn't a task field
 */
export function parseTaskFields(
	input?: string,
	options: { withSubtasks?: boolean } = {}
): TaskField[] | 'all' {
	const names = (input ?? '')
		.split(',')
		.map((name) => name.trim())
		.filter(Boolean);

	const unknown = names.filter(
		(name) =>
			name !== 'all' && !(TASK_FIELDS as readonly string[]).includes(name)
	);
	if (unknown.length > 0) {
		throw new TaskGraphError(
			`Unknown task field${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}. Valid fields: all, ${TASK_FIELDS.join(', ')}`,
			ERROR_CODES.VALIDATION_ERROR
		);
	}
	if (names.includes('all')) return 'all';
	const fields =
		names.length > 0 ? (names as TaskField[]) : DEFAULT_TASK_FIELDS;
	return [
		...new Set<TaskField>([
			'id',
			...fields,
			...(options.withSubtasks ? (['subtasks'] as const) : [])
		])
	].filter(
		(field) => !(field === 'subtasks' && options.withSubtasks === false)
	);
}

/**
 * Keep only the given fields of each task. Subtasks, when kept, carry the
 * same fields (those a subtask has).
 */
export function selectTaskFields(
	tasks: Task[],
	fields: TaskField[] | 'all'
): Partial<Task>[] {
	if (fields === 'all') return tasks;
	const pick = <T extends object>(item: T): Partial<T> => {
		const picked: Record<string, unknown> = {};
		for (const field of fields) {
			const value = (item as Record<string, unknown>)[field];
			if (value === undefined) continue;
			picked[field] =
				field === 'subtasks' && Array.isArray(value)
					? value.map((subtask: object) => pick(subtask))
					: value;
		}
		return picked as Partial<T>;
	};
	return tasks.map((task) => pick(task));
}
