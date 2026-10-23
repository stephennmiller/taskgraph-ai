/**
 * @fileoverview Progress notes on a task or subtask (`taskgraph note`).
 *
 * A note is appended to the item's `details` as written, wrapped in the same
 * timestamped block that update-subtask and research --save use:
 *
 *   <info added on 2026-10-23T14:02:11.000Z>
 *   Chose argon2 over bcrypt: the login API already depends on it
 *   </info added on 2026-10-23T14:02:11.000Z>
 *
 * so every appended note carries the time it was added.
 */

import {
	ERROR_CODES,
	TaskGraphError
} from '../../../common/errors/taskgraph-error.js';

/** What `addNote` saved */
export interface TaskNote {
	/** The task or subtask ID, as given ("3" or "3.2") */
	id: string;
	title: string;
	isSubtask: boolean;
	/** ISO time the note was added; also written into the note block */
	addedAt: string;
	/** The note as saved, after trimming blank lines around it */
	text: string;
}

/**
 * Trim what surrounds a note (blank lines, trailing spaces, the newline
 * `echo` adds) and keep the rest as written, indentation included.
 * Throws INVALID_INPUT when nothing is left.
 */
export function normalizeNoteText(text: string): string {
	const trimmed = text.replace(/^(\s*\n)+/, '').trimEnd();
	if (!trimmed.trim()) {
		throw new TaskGraphError('The note is empty', ERROR_CODES.INVALID_INPUT, {
			userMessage: 'The note is empty'
		});
	}
	return trimmed;
}

/** One note as a timestamped block */
export function formatNoteBlock(text: string, addedAt: string): string {
	return `<info added on ${addedAt}>\n${text}\n</info added on ${addedAt}>`;
}

/**
 * Append a note block to a task's details, on a new line after what's there
 */
export function appendNote(
	details: string | undefined,
	text: string,
	addedAt: string
): string {
	const block = formatNoteBlock(text, addedAt);
	return details ? `${details}\n${block}` : block;
}
