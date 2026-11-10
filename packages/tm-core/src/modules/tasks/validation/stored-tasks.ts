/**
 * @fileoverview The one check of what a tag's tasks may hold in status,
 * priority and ID (#1119). The storage write funnel refuses a write that
 * adds a problem (assertNoNewTaskProblems), and `doctor` reports every one a
 * file already holds (findStoredTaskProblems). Reads stay lenient, so a file
 * that is already wrong still loads and can be repaired.
 */

import {
	TASK_PRIORITIES,
	TASK_STATUSES
} from '../../../common/constants/index.js';
import {
	ERROR_CODES,
	errorWithHint
} from '../../../common/errors/taskgraph-error.js';
import { isStoredTaskId } from '../../../common/schemas/task-id.schema.js';
import { fullSubtaskId, isAssignableTaskId, isSubtaskId } from './task-id.js';

export type StoredTaskProblemKind =
	| 'unknown-status'
	| 'unknown-priority'
	| 'bad-id'
	| 'duplicate-id';

/** One value in a tag's tasks that the readers reject */
export interface StoredTaskProblem {
	kind: StoredTaskProblemKind;
	/** The task ("3") or subtask ("3.2"); `#4` (`3.#2`) for the fourth entry when its ID isn't a number */
	taskId: string;
	field: 'status' | 'priority' | 'id';
	/** What the field holds; for a duplicate ID, which repeat this is (2 for the second) */
	value: unknown;
	/** What is wrong, with the task and the field */
	message: string;
}

type Noun = 'Task' | 'Subtask';

const isObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null;

/** JSON.stringify escapes control characters a stored string could carry */
const shown = (value: unknown) => JSON.stringify(value) ?? String(value);

/**
 * Every status, priority and ID problem in one tag's tasks, as stored (IDs
 * may be numbers in older files). A missing status or priority is fine:
 * readers take it as the default. Never throws, whatever a hand edit left.
 */
export function findStoredTaskProblems(tasks: unknown): StoredTaskProblem[] {
	const problems: StoredTaskProblem[] = [];
	if (!Array.isArray(tasks)) return problems;

	const checkFields = (
		item: Record<string, unknown>,
		noun: Noun,
		taskId: string
	) => {
		const { status, priority } = item;
		if (status != null && !TASK_STATUSES.includes(status as never)) {
			problems.push({
				kind: 'unknown-status',
				taskId,
				field: 'status',
				value: status,
				message: `${noun} ${taskId} has status ${shown(status)}`
			});
		}
		if (priority != null && !TASK_PRIORITIES.includes(priority as never)) {
			problems.push({
				kind: 'unknown-priority',
				taskId,
				field: 'priority',
				value: priority,
				message: `${noun} ${taskId} has priority ${shown(priority)}`
			});
		}
	};

	/**
	 * Checks one ID among its siblings (`seen`). Returns the full ID to show,
	 * or null when it isn't a number: that text is never printed, so the
	 * problem names the entry's place instead.
	 */
	const checkId = (
		id: unknown,
		noun: Noun,
		place: string,
		seen: Map<string, number>,
		usable: (text: string) => boolean,
		fullId: (text: string) => string
	): string | null => {
		if (!isStoredTaskId(id)) {
			problems.push({
				kind: 'bad-id',
				taskId: place,
				field: 'id',
				value: place,
				message: `${noun} ${place} has an ID that isn't a number`
			});
			return null;
		}
		const text = String(id);
		const taskId = fullId(text);
		if (!usable(text)) {
			problems.push({
				kind: 'bad-id',
				taskId,
				field: 'id',
				value: text,
				message: `${noun} ${taskId} has an ID that can't be used`
			});
		}
		const count = (seen.get(text) ?? 0) + 1;
		seen.set(text, count);
		if (count > 1) {
			problems.push({
				kind: 'duplicate-id',
				taskId,
				field: 'id',
				value: count,
				message: `${count} ${noun.toLowerCase()}s have the ID ${taskId}`
			});
		}
		return taskId;
	};

	const taskIds = new Map<string, number>();
	tasks.forEach((task, index) => {
		const place = `#${index + 1}`;
		const id = checkId(
			isObject(task) ? task.id : undefined,
			'Task',
			place,
			taskIds,
			(text) => isAssignableTaskId(text) && !isSubtaskId(text),
			(text) => text
		);
		if (!isObject(task)) return;
		const parent = id ?? place;
		checkFields(task, 'Task', parent);
		if (!Array.isArray(task.subtasks)) return;
		const subtaskIds = new Map<string, number>();
		task.subtasks.forEach((subtask: unknown, subIndex: number) => {
			const subPlace = `${parent}.#${subIndex + 1}`;
			const subId = checkId(
				isObject(subtask) ? subtask.id : undefined,
				'Subtask',
				subPlace,
				subtaskIds,
				isAssignableTaskId,
				(text) => fullSubtaskId(parent, text)
			);
			if (isObject(subtask)) checkFields(subtask, 'Subtask', subId ?? subPlace);
		});
	});
	return problems;
}

/** What a value has to be, per kind of problem */
export const STORED_TASK_FIXES: Record<StoredTaskProblemKind, string> = {
	'unknown-status': `Use one of: ${TASK_STATUSES.join(', ')}`,
	'unknown-priority': `Use one of: ${TASK_PRIORITIES.join(', ')}`,
	'bad-id': 'An ID is a whole number from 1, at most 15 digits',
	'duplicate-id':
		'Each task in a tag, and each subtask of a task, needs its own ID'
};

const key = (problem: StoredTaskProblem) =>
	`${problem.kind}|${problem.taskId}|${shown(problem.value)}`;

/** The problems a tag's tasks hold before a write, for assertNoNewTaskProblems */
export function knownTaskProblems(tasks: unknown): Set<string> {
	return new Set(findStoredTaskProblems(tasks).map(key));
}

/**
 * The write funnel's check: refuse to save `tasks` when the write added a
 * status, priority or ID problem the tag didn't hold before (`known`, from
 * knownTaskProblems). One that was there already may stay, so the rest of
 * the project can still be edited and the value repaired.
 * @throws {TaskGraphError} VALIDATION_ERROR naming the task and the field
 */
export function assertNoNewTaskProblems(
	known: ReadonlySet<string>,
	tasks: unknown,
	tag: string
): void {
	const added = findStoredTaskProblems(tasks).find((p) => !known.has(key(p)));
	if (!added) return;
	throw errorWithHint(
		ERROR_CODES.VALIDATION_ERROR,
		`Can't save tag '${tag}': ${added.message}`,
		STORED_TASK_FIXES[added.kind]
	);
}
