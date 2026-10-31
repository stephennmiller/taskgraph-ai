/**
 * @fileoverview Pure helpers for UpdateTaskService (update-task.service.ts):
 * ID checks, the prompt's view of a task, and merging the AI's rewrite with
 * the task as it is now.
 */

import {
	ERROR_CODES,
	TaskGraphError,
	errorWithHint
} from '../../../common/errors/taskgraph-error.js';
import type { Subtask, Task } from '../../../common/types/index.js';
import {
	hasItemIds,
	isObject,
	same
} from '../../git/merge-driver/merge-json-utils.js';
import { isSiblingReference } from '../../dependencies/subtask-dependency.js';
import { mergeTagChanges } from '../../storage/adapters/file-storage/merge-tag-changes.js';

/** A positive whole number, as a string; `hint` says what to use instead */
export function taskIdOf(id: unknown, hint: string, allowZero = false): string {
	const text = String(id ?? '').trim();
	if (!/^\d+$/.test(text) || (Number(text) === 0 && !allowZero)) {
		throw errorWithHint(
			ERROR_CODES.VALIDATION_ERROR,
			`${JSON.stringify(text)} isn't a task ID`,
			hint
		);
	}
	return text;
}

/**
 * The task as the legacy reader handed it to the prompt, with number IDs
 * ("3" -> 3) for the task and its subtasks, and without the fields the
 * loader adds from the complexity report (the legacy reader added none)
 */
export function promptView(task: Task): Task {
	const num = (id: unknown) => (/^\d+$/.test(String(id)) ? Number(id) : id);
	// shortcut: also drops these fields when tasks.json itself holds them; read the raw file if that matters
	const {
		complexity: _c,
		recommendedSubtasks: _r,
		expansionPrompt: _e,
		complexityReasoning: _cr,
		...rest
	} = task;
	return {
		...rest,
		id: num(task.id),
		...(Array.isArray(task.subtasks) && {
			subtasks: task.subtasks.map((s) => ({ ...s, id: num(s.id) }))
		})
	} as Task;
}

/**
 * Apply what the rewrite changed (stored -> updated) to the task as it is
 * now, and warn about each field someone else changed too: the AI's wins.
 * Text appended to details meanwhile (a note) is kept after the AI's details.
 */
export function mergeRewrite(
	stored: Task,
	updated: Task,
	now: Task,
	warn: (message: string) => void
): Task {
	// Notes appended meanwhile (`taskgraph note`) go after the AI's details
	const base = stored.details ?? '';
	const note =
		typeof now.details === 'string' && now.details.startsWith(base)
			? now.details.slice(base.length)
			: '';
	const keepNote =
		note !== '' &&
		typeof updated.details === 'string' &&
		updated.details !== base;
	const read = keepNote ? { ...stored, details: now.details } : stored;
	const rewrite = keepNote
		? {
				...updated,
				details: [updated.details, note.replace(/^\n/, '')]
					.filter(Boolean)
					.join('\n')
			}
		: updated;
	const fields = read as unknown as Record<string, unknown>;
	const mine = rewrite as unknown as Record<string, unknown>;
	const theirs = now as unknown as Record<string, unknown>;
	for (const key of new Set([...Object.keys(mine), ...Object.keys(theirs)])) {
		const values = [fields[key], mine[key], theirs[key]];
		const [prior, ours, current] = values;
		// Objects and lists of items with IDs (subtasks) merge inside
		if (values.every(isObject) || values.every(hasItemIds)) continue;
		if (!same(prior, ours) && !same(prior, current) && !same(ours, current)) {
			warn(
				`The ${key} of task ${stored.id} changed while the AI was writing; the AI's version was saved`
			);
		}
	}
	return mergeTagChanges(
		{ tasks: [read] },
		{ tasks: [rewrite] },
		{ tasks: [now] }
	).merged.tasks[0];
}

/** The stored status, unless the prompt mentions status */
export function keepStatus(
	stored: Task,
	updated: { status?: unknown },
	prompt: string,
	warn: (message: string) => void
) {
	if (
		updated.status !== stored.status &&
		!prompt.toLowerCase().includes('status')
	) {
		warn(
			`AI changed task status. Restoring original status '${stored.status}'.`
		);
		updated.status = stored.status;
	}
}

/**
 * The stored subtask each of the AI's `subtasks` is, by index. Each stored
 * one matches once, across the whole list: ID and title first, then title
 * (the AI may renumber a reorder or an insert itself), then ID (the AI may
 * send strings)
 */
export function matchSubtasks(
	original: Subtask[],
	subtasks: Array<{ id?: unknown; title?: unknown }>
): (Subtask | undefined)[] {
	const sameId = (st: Subtask, subtask: { id?: unknown }) =>
		String(st.id) === String(subtask.id);
	const sameTitle = (st: Subtask, subtask: { title?: unknown }) =>
		Boolean(subtask.title) && st.title === subtask.title;
	const matched: (Subtask | undefined)[] = [];
	const taken = new Set<Subtask>();
	for (const same of [
		(st: Subtask, subtask: { id?: unknown; title?: unknown }) =>
			sameId(st, subtask) && sameTitle(st, subtask),
		sameTitle,
		sameId
	]) {
		subtasks.forEach((subtask, i) => {
			if (matched[i]) return;
			const before = original.find((st) => !taken.has(st) && same(st, subtask));
			if (!before) return;
			matched[i] = before;
			taken.add(before);
		});
	}
	return matched;
}

/**
 * The ID each of `count` rewritten subtasks is saved under: the stored
 * subtask it matched (see matchSubtasks), or the next ID after every stored
 * one, so no ID is reused
 */
export function keptSubtaskIds(
	original: Subtask[],
	matched: (Subtask | undefined)[],
	count: number
): string[] {
	// A dotted ID left as is ("4.1" under task 3) is not one of its numbers
	let next = Math.max(
		0,
		...original.map((st) => Number(st.id)).filter(Number.isInteger)
	);
	return Array.from({ length: count }, (_, i) =>
		String(matched[i] ? matched[i].id : ++next)
	);
}

/**
 * Each of the AI's `subtasks`' dependencies, with every sibling (2, or "5.2"
 * on task 5) named by its reply ID, else its saved ID (`ids`, by index), put
 * under its saved ID when it comes earlier in the reply and dropped when it
 * doesn't: saved IDs no longer follow reply order (#804). A stored subtask
 * the reply left out is kept (a done one comes back, and references to a
 * dropped one go on save); any other sibling number is dropped
 */
export function siblingsAsSaved(
	parentId: string,
	subtasks: Array<{ id?: unknown; dependencies?: unknown }>,
	ids: string[],
	original: Subtask[]
): unknown[] {
	const replyIndex = new Map<string, number>();
	subtasks.forEach((subtask, i) => {
		const key = String(subtask.id);
		if (!replyIndex.has(key)) replyIndex.set(key, i);
	});
	const prefix = `${parentId}.`;
	const siblingOf = (dep: unknown) => {
		if (typeof dep === 'number') {
			return isSiblingReference(dep) ? dep : undefined;
		}
		const text = typeof dep === 'string' ? dep.trim() : '';
		return text.startsWith(prefix)
			? Number(text.slice(prefix.length))
			: undefined;
	};
	return subtasks.map((subtask, i) => {
		if (!Array.isArray(subtask.dependencies)) return subtask.dependencies;
		return subtask.dependencies.flatMap((dep: unknown) => {
			const n = siblingOf(dep);
			if (n === undefined) return [dep];
			const j = replyIndex.get(String(n)) ?? ids.indexOf(String(n));
			if (j !== -1) return j < i ? [Number(ids[j])] : [];
			return original.some((st) => String(st.id) === String(n)) ? [n] : [];
		});
	});
}

/** `subtasks` with each done one of `original` restored as it was, no ID twice */
export function keepDoneSubtasks(
	original: Subtask[],
	subtasks: Subtask[],
	warn: (message: string) => void
): Subtask[] {
	const result = [...subtasks];
	for (const done of original.filter((st) => st.status === 'done')) {
		const index = result.findIndex((st) => String(st.id) === String(done.id));
		if (index !== -1 && same(result[index], done)) continue;
		warn(`Completed subtask ${done.id} was modified or removed. Restoring.`);
		// In its place when the AI kept it, else at the end
		if (index === -1) result.push(done);
		else result[index] = done;
	}
	const seen = new Set<string>();
	return result.filter((st) => {
		if (seen.has(String(st.id))) {
			warn(`Duplicate subtask ID ${st.id} removed.`);
			return false;
		}
		seen.add(String(st.id));
		return true;
	});
}

/**
 * The AI's dependency list as strings, or the stored list as it is when the
 * AI left it out or kept it (so an old file's number IDs aren't a change the
 * save would apply over a dependency added meanwhile)
 */
export function aiDependencies(dependencies: unknown, stored: Task) {
	if (!Array.isArray(dependencies)) return stored.dependencies ?? [];
	const next = dependencies.map(String);
	return same(next, (stored.dependencies ?? []).map(String))
		? stored.dependencies
		: next;
}

export const removedError = (id: string) =>
	new TaskGraphError(
		`Task ${id} was removed while it was being updated`,
		ERROR_CODES.TASK_NOT_FOUND
	);
