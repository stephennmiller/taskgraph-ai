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
 * so every appended note carries the time it was added. The time is
 * `Date.prototype.toISOString()` output (UTC, milliseconds, `Z`), and the
 * opening and closing markers carry the same value. Tools that read notes
 * back (the Stop hook, for one) rely on this format: keep it stable.
 */

import {
	ERROR_CODES,
	TaskGraphError
} from '../../../common/errors/taskgraph-error.js';

/**
 * The largest note `addNote` accepts, in UTF-8 bytes (64 KiB). A progress
 * note is a few lines; anything this big is almost always a log or a file
 * piped in by mistake, and it would bloat tasks.json and every `show`.
 */
export const MAX_NOTE_BYTES = 64 * 1024;

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
 * Throws INVALID_INPUT when nothing is left, or when the note is over
 * MAX_NOTE_BYTES.
 */
export function normalizeNoteText(text: string): string {
	const trimmed = String(text ?? '')
		.replace(/^(\s*\n)+/, '')
		.trimEnd();
	if (!trimmed.trim()) {
		throw new TaskGraphError('The note is empty', ERROR_CODES.INVALID_INPUT, {
			userMessage: 'The note is empty'
		});
	}
	if (Buffer.byteLength(trimmed, 'utf8') > MAX_NOTE_BYTES) {
		const message = `The note is over ${MAX_NOTE_BYTES / 1024} KB`;
		throw new TaskGraphError(message, ERROR_CODES.INVALID_INPUT, {
			userMessage: message
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

/** Opening tag of a timestamped block; the closing tag starts with `</` */
const NOTE_BLOCK_START = /<info added on ([^>\n]+)>/g;

/**
 * When each timestamped block in `details` was added, oldest first as they
 * appear. Covers `taskgraph note`, update-subtask and research --save blocks;
 * a block whose time doesn't parse is skipped.
 */
export function noteTimes(details: string | undefined): Date[] {
	if (!details) return [];
	const times: Date[] = [];
	for (const match of details.matchAll(NOTE_BLOCK_START)) {
		const time = new Date(match[1].trim());
		if (!Number.isNaN(time.getTime())) times.push(time);
	}
	return times;
}

/** Whether `details` has a timestamped block added at or after `since` */
export function hasNoteSince(details: string | undefined, since: Date): boolean {
	return noteTimes(details).some((time) => time >= since);
}

/**
 * Parse the start of a session as given on the command line (an ISO time).
 * Throws INVALID_INPUT when it isn't a time.
 */
export function parseNoteSince(value: string): Date {
	const since = new Date(String(value).trim());
	if (!String(value).trim() || Number.isNaN(since.getTime())) {
		throw new TaskGraphError(
			`Not a time: ${value}`,
			ERROR_CODES.INVALID_INPUT,
			{ userMessage: `Not a time: "${value}". Use an ISO time like 2026-10-23T14:02:11Z` }
		);
	}
	return since;
}
