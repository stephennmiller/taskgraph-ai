import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '../../../common/errors/taskgraph-error.js';
import {
	MAX_NOTE_BYTES,
	appendNote,
	formatNoteBlock,
	hasNoteSince,
	lastNote,
	normalizeNoteText,
	noteTimes,
	parseNoteSince,
	splitNotes
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

describe('noteTimes', () => {
	it('reads the time of each block, not its closing tag', () => {
		const details = appendNote(
			appendNote('Plan', 'first', '2026-10-23T10:00:00.000Z'),
			'second',
			'2026-10-23T12:30:00.000Z'
		);

		expect(noteTimes(details).map((t) => t.toISOString())).toEqual([
			'2026-10-23T10:00:00.000Z',
			'2026-10-23T12:30:00.000Z'
		]);
	});

	it('skips a block whose time does not parse, and handles no details', () => {
		expect(
			noteTimes('<info added on someday>\nx\n</info added on someday>')
		).toEqual([]);
		expect(noteTimes(undefined)).toEqual([]);
		expect(noteTimes('')).toEqual([]);
	});
});

describe('splitNotes', () => {
	const first = '2026-10-23T10:00:00.000Z';
	const second = '2026-10-23T12:30:00.000Z';

	it('returns each block oldest first, and the text around them without the blocks', () => {
		const details = `${appendNote(appendNote('Plan:\n  use argon2', 'first\nline two', first), 'second', second)}\nAfterword`;

		const { text, notes } = splitNotes(details);

		expect(text).toBe('Plan:\n  use argon2\nAfterword');
		expect(notes).toEqual([
			{ addedAt: new Date(first), text: 'first\nline two' },
			{ addedAt: new Date(second), text: 'second' }
		]);
	});

	it('leaves no text when the details are only notes, and none for no details', () => {
		expect(splitNotes(appendNote(undefined, 'only', first))).toEqual({
			text: '',
			notes: [{ addedAt: new Date(first), text: 'only' }]
		});
		expect(splitNotes(undefined)).toEqual({ text: '', notes: [] });
	});

	it('keeps a block in the text when its time does not parse or its tags differ', () => {
		const unparsed = '<info added on someday>\nx\n</info added on someday>';
		const unclosed = `<info added on ${first}>\nx\n</info added on ${second}>`;

		expect(splitNotes(unparsed)).toEqual({ text: unparsed, notes: [] });
		expect(splitNotes(unclosed)).toEqual({ text: unclosed, notes: [] });
	});
});

describe('lastNote', () => {
	it('is the text of the block that ends the details, and nothing when text follows it', () => {
		const details = appendNote(
			appendNote('Plan', 'first', '2026-10-23T10:00:00.000Z'),
			'second\nline',
			'2026-10-23T12:30:00.000Z'
		);

		expect(lastNote(`${details}\n`)).toBe('second\nline');
		expect(lastNote(`${details}\nAfterword`)).toBeUndefined();
	});
});

describe('hasNoteSince', () => {
	const details = appendNote('', 'did it', '2026-10-23T12:00:00.500Z');

	it('counts a note added at or after the time', () => {
		expect(hasNoteSince(details, new Date('2026-10-23T12:00:00Z'))).toBe(true);
		expect(hasNoteSince(details, new Date('2026-10-23T12:00:00.500Z'))).toBe(
			true
		);
	});

	it('ignores a note added before the time', () => {
		expect(hasNoteSince(details, new Date('2026-10-23T12:00:01Z'))).toBe(false);
		expect(hasNoteSince('plain text, no notes', new Date(0))).toBe(false);
	});
});

describe('parseNoteSince', () => {
	it('parses an ISO time', () => {
		expect(parseNoteSince('2026-10-23T14:02:11Z').toISOString()).toBe(
			'2026-10-23T14:02:11.000Z'
		);
	});

	it.each(['', '  ', 'yesterday'])('rejects %j', (value) => {
		expect(() => parseNoteSince(value)).toThrow(
			expect.objectContaining({ code: ERROR_CODES.INVALID_INPUT })
		);
	});
});
