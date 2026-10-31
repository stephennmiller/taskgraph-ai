import { describe, expect, it } from 'vitest';
import { sanitizeForTerminal, stripTerminalControls } from './terminal-text.js';

// Anything a terminal could act on: ESC, C0 (but tab and newline), DEL, C1
const ACTIONABLE = /[\x00-\x08\x0b-\x1f\x7f-\x9f]/;

describe('stripTerminalControls', () => {
	it('removes CSI sequences: colors, cursor moves, screen clears', () => {
		expect(
			stripTerminalControls('\x1b[31mRed\x1b[0m \x1b[2J\x1b[1;1Hlogin\x1b[?25l')
		).toBe('Red login');
	});

	it('removes OSC sequences ended by BEL or by ST', () => {
		expect(stripTerminalControls('a\x1b]0;pwned\x07b')).toBe('ab');
		expect(stripTerminalControls('a\x1b]52;c;ZXZpbA==\x1b\\b')).toBe('ab');
	});

	it('removes an OSC 8 hyperlink but keeps its visible text', () => {
		const link =
			'\x1b]8;;https://evil.example\x1b\\https://good.example\x1b]8;;\x1b\\';

		expect(stripTerminalControls(`See ${link}`)).toBe(
			'See https://good.example'
		);
	});

	it('removes an unterminated OSC to the end of the text', () => {
		expect(stripTerminalControls('Title\x1b]0;never ends')).toBe('Title');
	});

	it('removes DCS, APC and other ESC sequences, and a bare ESC', () => {
		expect(stripTerminalControls('a\x1bP1$qm\x1b\\b')).toBe('ab');
		expect(stripTerminalControls('a\x1b_payload\x1b\\b')).toBe('ab');
		expect(stripTerminalControls('reset\x1bc here')).toBe('reset here');
		expect(stripTerminalControls('charset\x1b(B ok')).toBe('charset ok');
		expect(stripTerminalControls('trailing\x1b')).toBe('trailing');
	});

	it('removes 8-bit C1 sequences and controls', () => {
		expect(stripTerminalControls('a\u009b2Jb')).toBe('ab');
		expect(stripTerminalControls('a\u009d0;t\u009cb')).toBe('ab');
		expect(stripTerminalControls('a\u0085b\u0090')).toBe('ab');
	});

	it('removes C0 controls, DEL and bidi overrides', () => {
		expect(
			stripTerminalControls('a\x00b\x07c\x08d\x7fe \u202eesrever\u202c')
		).toBe('abcde esrever');
	});

	it('keeps newlines and tabs, and turns CRLF into LF', () => {
		expect(stripTerminalControls('Steps:\r\n\t1. one\n\t2. two\rX')).toBe(
			'Steps:\n\t1. one\n\t2. twoX'
		);
	});

	it('leaves ordinary text, including non-ASCII, as it is', () => {
		const text = 'Café → naïve 日本語 [link](x) 100% done ✓';

		expect(stripTerminalControls(text)).toBe(text);
	});

	it('returns one trimmed line with singleLine', () => {
		expect(
			stripTerminalControls(' Fix\x1b[2J the\r\nlogin\x00\tAPI ', {
				singleLine: true
			})
		).toBe('Fix the login API');
	});
});

describe('sanitizeForTerminal', () => {
	it('cleans every string in a task, its subtasks and its metadata', () => {
		const task = {
			id: 1,
			title: 'Fix\x1b[2J login',
			details: 'Line 1\nLine\x1b]0;x\x07 2',
			dependencies: [2, '3\x1b[1A'],
			acceptanceCriteria: [
				{ text: 'Works\x1b]8;;http://x\x1b\\', checked: true }
			],
			subtasks: [{ id: 1, title: 'Sub\x07task', parentId: 1 }],
			metadata: { 'key\x1b[2J': 'value\x9b2J' },
			complexity: null,
			updatedAt: undefined
		};

		const safe = sanitizeForTerminal(task);

		expect(safe).toEqual({
			id: 1,
			title: 'Fix login',
			details: 'Line 1\nLine 2',
			dependencies: [2, '3'],
			acceptanceCriteria: [{ text: 'Works', checked: true }],
			subtasks: [{ id: 1, title: 'Subtask', parentId: 1 }],
			metadata: { key: 'value' },
			complexity: null,
			updatedAt: undefined
		});
		expect(JSON.stringify(safe)).not.toMatch(/\\u00[01]|\\u007f|\\u009/);
		expect(ACTIONABLE.test(safe.title)).toBe(false);
	});

	it('leaves the input unchanged', () => {
		const task = { title: 'a\x1b[2Jb', subtasks: [{ title: '\x07' }] };

		sanitizeForTerminal(task);

		expect(task).toEqual({ title: 'a\x1b[2Jb', subtasks: [{ title: '\x07' }] });
	});

	it('cleans a bare string or array', () => {
		expect(sanitizeForTerminal('x\x1b[2Jy')).toBe('xy');
		expect(sanitizeForTerminal(['\x1b]0;t\x07ok'])).toEqual(['ok']);
	});

	it('keeps class instances such as dates as they are', () => {
		const date = new Date(0);

		expect(sanitizeForTerminal({ at: date }).at).toBe(date);
	});

	it('handles shared and circular references', () => {
		const shared = { title: 't\x07' };
		const node: Record<string, unknown> = { a: shared, b: shared };
		node.self = node;

		const safe = sanitizeForTerminal(node);

		expect(safe.a).toEqual({ title: 't' });
		expect(safe.b).toBe(safe.a);
		expect(safe.self).toBe(safe);
	});

	it('copies nesting too deep for recursion', () => {
		let deep: { title: string; children: unknown[] } = {
			title: 'x\x1b[2Jy',
			children: []
		};
		for (let i = 0; i < 100000; i++) deep = { title: 'ok', children: [deep] };

		let safe = sanitizeForTerminal(deep);
		while (safe.children.length) safe = safe.children[0] as typeof deep;

		expect(safe.title).toBe('xy');
	});
});
