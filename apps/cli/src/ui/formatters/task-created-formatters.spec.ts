import { stripVTControlCharacters } from 'node:util';
import { describe, expect, it } from 'vitest';
import { formatTaskCreated } from './task-created-formatters.js';

const plain = (text: string) => stripVTControlCharacters(text);
const lines = (text: string) => plain(text).split('\n');
const widest = (text: string) =>
	Math.max(...lines(text).map((line) => line.length));

const exportTask = {
	id: 4,
	title: 'Export bookmarks as a Netscape HTML file',
	priority: 'medium',
	dependencies: [
		{ id: 1, title: 'Set up the database schema' },
		{
			id: 2,
			title: 'Email and password sign-in with sessions',
			addedByAi: true
		},
		{ id: 3, title: 'Bookmark CRUD endpoints', addedByAi: true }
	]
};

describe('formatTaskCreated', () => {
	it('leads with one ✓ line, then aligned dependency rows and one next step', () => {
		expect(lines(formatTaskCreated(exportTask, 80))).toEqual([
			'✓ Added task 4  Export bookmarks as a Netscape HTML file · medium priority',
			'  Depends on  1  Set up the database schema',
			'              2  Email and password sign-in with sessions  added by AI',
			'              3  Bookmark CRUD endpoints                   added by AI',
			'Next: taskgraph show 4 to read it, or taskgraph expand --id=4 to break it down'
		]);
	});

	it('is two lines for a task with no dependencies', () => {
		const output = formatTaskCreated(
			{ id: 1, title: 'Write the README', dependencies: [] },
			80
		);

		expect(lines(output)).toEqual([
			'✓ Added task 1  Write the README',
			'Next: taskgraph show 1 to read it, or taskgraph expand --id=1 to break it down'
		]);
	});

	it('marks only the dependencies the AI added', () => {
		const output = formatTaskCreated(
			{
				id: 5,
				title: 'Write the README',
				dependencies: [
					{ id: 1, title: 'Set up the database schema' },
					{ id: 3, title: 'Bookmark CRUD endpoints', addedByAi: true }
				]
			},
			80
		);

		expect(lines(output).slice(1, 3)).toEqual([
			'  Depends on  1  Set up the database schema',
			'              3  Bookmark CRUD endpoints     added by AI'
		]);
	});

	it('shows where the task was discovered, apart from what it depends on', () => {
		const output = formatTaskCreated(
			{
				id: 6,
				title: 'Fix the flaky login test',
				dependencies: [{ id: 1, title: 'Set up the database schema' }],
				discoveredFrom: { id: '2.1', title: 'Password hashing helpers' }
			},
			80
		);

		expect(lines(output).slice(1, 3)).toEqual([
			'  Depends on       1    Set up the database schema',
			'  Discovered from  2.1  Password hashing helpers'
		]);
	});

	it('names a dependency it cannot find', () => {
		const output = formatTaskCreated(
			{ id: 2, title: 'Two', dependencies: [{ id: 9, title: '' }] },
			80
		);

		expect(plain(output)).toContain('  Depends on  9  unknown task');
	});

	it('fits 80 columns with long titles', () => {
		const long =
			'A very long task title that keeps going well past any sensible width';
		const output = formatTaskCreated(
			{
				id: 120,
				title: long,
				priority: 'high',
				dependencies: [
					{ id: 7, title: long },
					{ id: 101, title: long, addedByAi: true }
				]
			},
			80
		);

		expect(widest(output)).toBeLessThanOrEqual(80);
		expect(lines(output)[0]).toMatch(
			/^✓ Added task 120 {2}A very long.*… · high priority$/
		);
	});

	it('removes escape sequences from titles', () => {
		const output = formatTaskCreated(
			{
				id: 8,
				title: 'Title \u001b]0;pwned\u0007here',
				dependencies: [{ id: 2, title: 'Dep \u001b[2Jclear' }]
			},
			80
		);

		expect(output).not.toMatch(/\u001b\]0;|\u0007|\u001b\[2J/);
		expect(plain(output)).toContain('Added task 8  Title here');
		expect(plain(output)).toContain('2  Dep clear');
	});

	it('cuts titles and wraps the next step in a narrow terminal', () => {
		const output = formatTaskCreated(exportTask, 50);

		expect(widest(output)).toBeLessThanOrEqual(50);
		expect(lines(output)).toEqual([
			'✓ Added task 4  Export bookmark… · medium priority',
			'  Depends on  1  Set up the database…',
			'              2  Email and password…   added by AI',
			'              3  Bookmark CRUD endpo…  added by AI',
			'Next: taskgraph show 4 to read it, or taskgraph',
			'      expand --id=4 to break it down'
		]);
	});
});
