/**
 * @fileoverview Acceptance criteria and the Definition of Done: the checklist
 * a task must clear before `set-status done` accepts it.
 *
 * A task's checklist is its own acceptance criteria, numbered from 1, then
 * the project's Definition of Done (config `global.definitionOfDone`),
 * numbered on from there. The Definition of Done applies to top-level tasks
 * only; a subtask is gated by its own criteria.
 */

import {
	ERROR_CODES,
	TaskGraphError
} from '../../../common/errors/taskgraph-error.js';
import type {
	AcceptanceCriterion,
	Subtask,
	Task
} from '../../../common/types/index.js';

/** One numbered line of a task's checklist */
export interface ChecklistItem {
	/** 1-based, as `--check` takes it */
	number: number;
	text: string;
	checked: boolean;
	/** The task's own criterion, or an item of the Definition of Done */
	source: 'task' | 'definition-of-done';
}

/** Everything that has to be checked before a task can be marked done */
export interface TaskChecklist {
	items: ChecklistItem[];
	checkedCount: number;
	unchecked: ChecklistItem[];
}

/** The numbers to check off and to clear again */
export interface ChecklistChanges {
	check?: number[];
	uncheck?: number[];
}

/** The fields of a task that hold checklist state */
export type ChecklistFields = Pick<
	Task,
	'acceptanceCriteria' | 'definitionOfDoneChecked'
>;

/**
 * Read stored criteria in either format: a plain string (older files) is an
 * unchecked criterion. Blank and malformed entries are dropped.
 */
export function normalizeAcceptanceCriteria(
	raw: unknown
): AcceptanceCriterion[] {
	if (!Array.isArray(raw)) return [];
	const criteria: AcceptanceCriterion[] = [];
	for (const entry of raw) {
		if (typeof entry === 'string') {
			if (entry.trim()) criteria.push({ text: entry.trim(), checked: false });
		} else if (
			entry &&
			typeof entry === 'object' &&
			typeof (entry as AcceptanceCriterion).text === 'string' &&
			(entry as AcceptanceCriterion).text.trim()
		) {
			criteria.push({
				text: (entry as AcceptanceCriterion).text.trim(),
				checked: (entry as AcceptanceCriterion).checked === true
			});
		}
	}
	return criteria;
}

/**
 * Copy a task's checklist state (its criteria and checked Definition of Done
 * items) from the task as stored onto a rewritten version of it. AI rewrites
 * (`update-task`, `update`) return tasks without these fields; without this
 * they would drop the criteria and, with them, the done gate.
 *
 * @param target - The rewritten task or subtask, changed in place
 * @param source - The task or subtask as stored, if there was one
 * @returns The target
 */
export function keepChecklistFields<T extends object>(
	target: T,
	source: ChecklistFields | undefined
): T {
	if (!source) return target;
	const fields = target as ChecklistFields;
	if (source.acceptanceCriteria !== undefined) {
		fields.acceptanceCriteria = source.acceptanceCriteria;
	}
	if (source.definitionOfDoneChecked !== undefined) {
		fields.definitionOfDoneChecked = source.definitionOfDoneChecked;
	}
	return target;
}

/**
 * The Definition of Done as configured: a list of non-blank strings.
 * Anything else reads as no Definition of Done.
 */
export function normalizeDefinitionOfDone(raw: unknown): string[] {
	if (!Array.isArray(raw)) return [];
	const items = raw
		.filter((item): item is string => typeof item === 'string')
		.map((item) => item.trim())
		.filter(Boolean);
	return [...new Set(items)];
}

/**
 * Build a task's checklist.
 *
 * @param task - The task or subtask as stored
 * @param definitionOfDone - The project's Definition of Done
 * @param isSubtask - Subtasks skip the Definition of Done
 */
export function buildChecklist(
	task: Pick<Task | Subtask, 'acceptanceCriteria' | 'definitionOfDoneChecked'>,
	definitionOfDone: string[],
	isSubtask = false
): TaskChecklist {
	const items: ChecklistItem[] = normalizeAcceptanceCriteria(
		task.acceptanceCriteria
	).map((criterion, index) => ({
		number: index + 1,
		text: criterion.text,
		checked: criterion.checked,
		source: 'task'
	}));

	if (!isSubtask) {
		const done = new Set(task.definitionOfDoneChecked ?? []);
		for (const text of normalizeDefinitionOfDone(definitionOfDone)) {
			items.push({
				number: items.length + 1,
				text,
				checked: done.has(text),
				source: 'definition-of-done'
			});
		}
	}

	const unchecked = items.filter((item) => !item.checked);
	return {
		items,
		checkedCount: items.length - unchecked.length,
		unchecked
	};
}

/**
 * Check and uncheck items by number, returning the task fields to save.
 * Throws INVALID_INPUT, before anything changes, for a number the checklist
 * doesn't have.
 */
export function applyChecklistChanges(
	task: Pick<Task | Subtask, 'acceptanceCriteria' | 'definitionOfDoneChecked'>,
	taskId: string,
	definitionOfDone: string[],
	changes: ChecklistChanges,
	isSubtask = false
): ChecklistFields {
	const checklist = buildChecklist(task, definitionOfDone, isSubtask);
	const wanted = new Map<number, boolean>();
	for (const n of changes.uncheck ?? []) wanted.set(n, false);
	for (const n of changes.check ?? []) wanted.set(n, true);

	const total = checklist.items.length;
	for (const n of wanted.keys()) {
		if (!Number.isInteger(n) || n < 1 || n > total) {
			const what = isSubtask ? 'Subtask' : 'Task';
			throw new TaskGraphError(
				total === 0
					? `${what} ${taskId} has no criteria to check`
					: `${what} ${taskId} has ${total} ${plural(total, 'criterion', 'criteria')}; there's no ${n}`,
				ERROR_CODES.INVALID_INPUT,
				{ details: { taskId, number: n, total } }
			);
		}
	}

	const criteria: AcceptanceCriterion[] = [];
	const doneChecked: string[] = [];
	for (const item of checklist.items) {
		const checked = wanted.get(item.number) ?? item.checked;
		if (item.source === 'task') {
			criteria.push({ text: item.text, checked });
		} else if (checked) {
			doneChecked.push(item.text);
		}
	}

	const fields: ChecklistFields = {};
	if (criteria.length > 0) fields.acceptanceCriteria = criteria;
	if (!isSubtask && normalizeDefinitionOfDone(definitionOfDone).length > 0) {
		fields.definitionOfDoneChecked = doneChecked;
	}
	return fields;
}

/**
 * The error `set-status done` raises while items are unchecked, or
 * undefined when the task can be marked done. The unchecked items ride in
 * `context.details.unchecked` (read them with `getUncheckedCriteria`).
 */
export function checkDoneGate(
	task: Pick<Task | Subtask, 'acceptanceCriteria' | 'definitionOfDoneChecked'>,
	taskId: string,
	definitionOfDone: string[],
	isSubtask = false
): TaskGraphError | undefined {
	const { unchecked } = buildChecklist(task, definitionOfDone, isSubtask);
	if (unchecked.length === 0) return undefined;
	const message = `${unchecked.length} ${plural(unchecked.length, 'criterion', 'criteria')} unchecked on ${isSubtask ? 'subtask' : 'task'} ${taskId}`;
	return new TaskGraphError(message, ERROR_CODES.CRITERIA_UNCHECKED, {
		userMessage: message,
		details: { taskId, unchecked }
	});
}

/** The unchecked items carried by a done-gate error, if it is one */
export function getUncheckedCriteria(
	error: unknown
): { taskId: string; unchecked: ChecklistItem[] } | undefined {
	if (
		error instanceof TaskGraphError &&
		error.code === ERROR_CODES.CRITERIA_UNCHECKED
	) {
		const details = error.context.details as
			| { taskId: string; unchecked: ChecklistItem[] }
			| undefined;
		if (details && Array.isArray(details.unchecked)) return details;
	}
	return undefined;
}

/**
 * Read a list of checklist numbers as a user types it: "2", "2,4", "2, 4".
 * Throws INVALID_INPUT naming the first value that isn't a whole number.
 */
export function parseChecklistNumbers(input: string | string[]): number[] {
	const parts = (Array.isArray(input) ? input : [input])
		.flatMap((value) => String(value).split(','))
		.map((value) => value.trim())
		.filter(Boolean);
	return parts.map((part) => {
		if (!/^\d+$/.test(part) || Number(part) < 1) {
			throw new TaskGraphError(
				`"${part}" isn't a criterion number`,
				ERROR_CODES.INVALID_INPUT,
				{ details: { value: part } }
			);
		}
		return Number(part);
	});
}

function plural(count: number, one: string, many: string): string {
	return count === 1 ? one : many;
}
