import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '../../../common/errors/taskgraph-error.js';
import {
	MAX_NOTE_BYTES,
	appendNote,
	formatNoteBlock,
	normalizeNoteText
} from './notes.js';

describe('normalizeNoteText', () => {
	it('keeps the text as written, inner lines and indentation included', () => {
		const text = 'Chose argon2\n  - faster to verify\n  - already a dependency';

		expect(normalizeNoteText(text)).toBe(text);
	});

	it('drops blank lines around the note and the trailing newline', () => {
		expect(normalizeNoteText('\n\n  Fixed the cookie path  \n\n')).toBe(
			'  Fixed the cookie path'
		);
	});

	it('refuses an empty or whitespace-only note', () => {
		for (const text of ['', '   ', '\n\t\n']) {
			expect(() => normalizeNoteText(text)).toThrow(
				expect.objectContaining({ code: ERROR_CODES.INVALID_INPUT })
			);
		}
	});
});

describe('normalizeNoteText size limit', () => {
	it('accepts a note of exactly MAX_NOTE_BYTES', () => {
		const text = 'a'.repeat(MAX_NOTE_BYTES);

		expect(normalizeNoteText(text)).toBe(text);
	});

	it('refuses a note over MAX_NOTE_BYTES, counting UTF-8 bytes', () => {
		// 'é' is 2 bytes, so this is MAX_NOTE_BYTES + 2 bytes in half as many characters
		const text = 'é'.repeat(MAX_NOTE_BYTES / 2 + 1);

		expect(() => normalizeNoteText(text)).toThrow(
			expect.objectContaining({
				code: ERROR_CODES.INVALID_INPUT,
				message: 'The note is over 64 KB'
			})
		);
	});
});

describe('appendNote', () => {
	const at = '2026-10-23T14:02:11.000Z';

	it('wraps the note in a block stamped with the time it was added', () => {
		expect(formatNoteBlock('Done', at)).toBe(
			`<info added on ${at}>\nDone\n</info added on ${at}>`
		);
	});

	it('starts empty details with the note block', () => {
		expect(appendNote(undefined, 'Done', at)).toBe(formatNoteBlock('Done', at));
		expect(appendNote('', 'Done', at)).toBe(formatNoteBlock('Done', at));
	});

	it('adds the note after existing details on a new line', () => {
		expect(appendNote('Use JWT', 'Done', at)).toBe(
			`Use JWT\n${formatNoteBlock('Done', at)}`
		);
	});
});
