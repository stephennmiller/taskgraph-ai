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

/** Most criteria kept from one generated task; the prompts ask for 2-5 */
export const MAX_GENERATED_CRITERIA = 10;

/** Longest generated criterion kept, in characters; longer ones are cut */
export const MAX_GENERATED_CRITERION_LENGTH = 300;

// Terminal escape sequences (CSI, OSC and other ESC-introduced ones)
const ESCAPE_SEQUENCE =
	// biome-ignore lint/suspicious/noControlCharactersInRegex: matching them is the point
	/\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)?|[@-Z\\-_])/g;
// C0/C1 control characters and the bidirectional overrides that can make
// text display differently from what it says
const CONTROL_CHARACTERS =
	// biome-ignore lint/suspicious/noControlCharactersInRegex: matching them is the point
	/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

/**
 * One generated criterion made safe to store and print: escape sequences
 * and control characters removed, whitespace collapsed to single spaces,
 * and cut to MAX_GENERATED_CRITERION_LENGTH characters.
 */
function sanitizeGeneratedCriterion(text: string): string {
	const clean = text
		.replace(ESCAPE_SEQUENCE, '')
		.replace(CONTROL_CHARACTERS, ' ')
		.replace(/\s+/g, ' ')
		.trim();
	const chars = Array.from(clean);
	if (chars.length <= MAX_GENERATED_CRITERION_LENGTH) return clean;
	return `${chars
		.slice(0, MAX_GENERATED_CRITERION_LENGTH - 1)
		.join('')
		.trimEnd()}…`;
}

/**
 * Store the acceptance criteria an AI wrote for a new task or subtask
 * (`parse-prd`, `expand`): each one as an unchecked item, since nothing has
 * been verified yet. The text is AI output, so it is sanitized (no escape
 * sequences or control characters, at most MAX_GENERATED_CRITERION_LENGTH
 * characters), duplicates are dropped, and at most MAX_GENERATED_CRITERIA
 * are kept. A missing, null, malformed or empty list leaves the field off,
 * so a response without criteria saves the task as it did before.
 *
 * @param task - The generated task or subtask, changed in place
 * @returns The task
 */
export function setGeneratedCriteria<T extends object>(task: T): T {
	const fields = task as ChecklistFields;
	const seen = new Set<string>();
	const criteria: AcceptanceCriterion[] = [];
	for (const { text: raw } of normalizeAcceptanceCriteria(
		fields.acceptanceCriteria
	)) {
		const text = sanitizeGeneratedCriterion(raw);
		if (!text || seen.has(text)) continue;
		seen.add(text);
		criteria.push({ text, checked: false });
		if (criteria.length === MAX_GENERATED_CRITERIA) break;
	}
	if (criteria.length > 0) {
		fields.acceptanceCriteria = criteria;
	} else {
		delete fields.acceptanceCriteria;
	}
	return task;
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
