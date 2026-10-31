import { stripVTControlCharacters } from 'node:util';
import { describe, expect, it } from 'vitest';
import {
	formatNoteAdded,
	formatNotesAdded,
	formatNothingToUpdate,
	formatTasksUpdated,
	formatTaskUpdated,
	formatAssigned
} from './task-update-formatters.js';

const plain = (text: string) => stripVTControlCharacters(text);
const widest = (text: string) =>
	Math.max(
		...plain(text)
			.split('\n')
			.map((line) => line.length)
	);

const longTitle =
	"Store todos in a SQLite database in the user's home folder so runs can't lose one";

describe('formatTaskUpdated', () => {
	it('names the task and says how to see the change', () => {
		const output = plain(
			formatTaskUpdated({ id: 2, title: 'Build the login API' }, 80)
		);

		expect(output.split('\n')).toEqual([
			'✓ Updated task 2  Build the login API',
			'Run taskgraph show 2 to see what changed'
		]);
	});

	it.each([80, 50])('cuts a long title to fit %i columns', (width) => {
		const output = formatTaskUpdated({ id: 12, title: longTitle }, width);

		expect(widest(output)).toBeLessThanOrEqual(width);
		expect(plain(output).split('\n')[0].endsWith('…')).toBe(true);
	});
});

describe('formatNoteAdded', () => {
	it('drops escape sequences and line breaks from a title in tasks.json', () => {
		const output = formatNoteAdded(
			{
				id: 3,
				title: 'Store\u001b]0;pwned\u0007 sessions\u001b[2J\nnow',
				isSubtask: false
			},
			80
		);

		expect(output).not.toMatch(/\u001b\]|\u0007|\u001b\[2J|\n/);
		expect(plain(output)).toBe('✓ Added a note to task 3  Store sessions now');
	});

	it('prints one result line naming the task, without echoing the note', () => {
		const output = plain(
			formatNoteAdded({ id: 3, title: 'Store sessions', isSubtask: false }, 80)
		);

		expect(output).toBe('✓ Added a note to task 3  Store sessions');
	});

	it('says subtask for a subtask ID', () => {
		const output = plain(
			formatNoteAdded(
				{ id: '3.2', title: 'Hash passwords', isSubtask: true },
				80
			)
		);

		expect(output).toBe('✓ Added a note to subtask 3.2  Hash passwords');
	});

	it('cuts a long title to fit 80 columns on one line', () => {
		const output = formatNoteAdded(
			{ id: '12.10', title: longTitle, isSubtask: true },
			80
		);

		expect(plain(output).split('\n')).toHaveLength(1);
		expect(widest(output)).toBeLessThanOrEqual(80);
		expect(plain(output)).toContain('…');
	});
});

describe('formatNotesAdded', () => {
	const notes =
		'Keep the schema to one `todos` table: `id`, `text`, `done` and `created_at`. ' +
		'A second table for tags can wait until someone asks for tags.';

	it('leads with the result and indents the notes under it', () => {
		const lines = plain(
			formatNotesAdded(
				{ kind: 'subtask', id: '1.1', title: 'Define the command table' },
				notes,
				80
			)
		).split('\n');

		expect(lines[0]).toBe(
			'✓ Added notes to subtask 1.1  Define the command table'
		);
		expect(lines.slice(1).every((line) => line.startsWith('  '))).toBe(true);
		expect(lines.join(' ').replace(/\s+/g, ' ')).toContain(
			'A second table for tags'
		);
	});

	it('drops the labels and info markers the box used to show', () => {
		const output = plain(
			formatNotesAdded({ kind: 'task', id: 2, title: 'Storage' }, notes, 80)
		);

		expect(output).not.toMatch(/Title:|Newly Added|<info added on/);
	});

	it.each([80, 60])('wraps the notes and title to %i columns', (width) => {
		const output = formatNotesAdded(
			{ kind: 'task', id: 2, title: longTitle },
			notes.repeat(3),
			width
		);

		expect(widest(output)).toBeLessThanOrEqual(width);
	});

	it('keeps notes inside a terminal narrower than the renderer wraps', () => {
		const output = formatNotesAdded(
			{ kind: 'task', id: 2, title: 'Storage' },
			notes,
			40
		);

		expect(widest(output)).toBeLessThanOrEqual(40);
	});

	it('says so in one line when the AI returned nothing', () => {
		expect(
			plain(
				formatNotesAdded({ kind: 'subtask', id: '3.2', title: 'X' }, '  ', 80)
			)
		).toBe('⚠ Nothing added to subtask 3.2: the AI returned no text');
	});
});

describe('formatTasksUpdated', () => {
	it('lists each updated task on an aligned row', () => {
		const output = plain(
			formatTasksUpdated(
				[
					{ id: 2, title: 'Store todos in SQLite' },
					{ id: 10, title: 'Print the list' }
				],
				80
			)
		);

		expect(output.split('\n')).toEqual([
			'✓ Updated 2 tasks',
			'  2   Store todos in SQLite',
			'  10  Print the list',
			'Run taskgraph show <id> to see what changed'
		]);
	});

	it('uses the single-task line for one task', () => {
		expect(
			plain(formatTasksUpdated([{ id: 4, title: 'Docs' }], 80)).split('\n')[0]
		).toBe('✓ Updated task 4  Docs');
	});

	it.each([80, 40])('fits %i columns', (width) => {
		const output = formatTasksUpdated(
			[
				{ id: 2, title: longTitle },
				{ id: 3, title: longTitle }
			],
			width
		);

		expect(widest(output)).toBeLessThanOrEqual(width);
	});

	it('says nothing changed when the AI returned none of the tasks', () => {
		expect(formatTasksUpdated([], 80)).toBe(
			'No tasks changed: the AI returned none of the tasks it was sent'
		);
	});
});

describe('formatNothingToUpdate', () => {
	it('names the starting ID and points at list', () => {
		expect(plain(formatNothingToUpdate(9)).split('\n')).toEqual([
			'No tasks to update: none from 9 on are unfinished',
			'Run taskgraph list to see task IDs'
		]);
	});
});

describe('formatAssigned', () => {
	it('names who the task is for, or that nobody is', () => {
		const task = { id: 3, title: 'Store sessions' };

		expect(plain(formatAssigned(task, 'octocat', 80))).toBe(
			'✓ Assigned task 3 to octocat  Store sessions'
		);
		expect(plain(formatAssigned(task, undefined, 80))).toBe(
			'✓ Unassigned task 3  Store sessions'
		);
	});
});
