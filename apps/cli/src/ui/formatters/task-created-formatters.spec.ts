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
		{
			id: 2,
			title: 'Email and password sign-in with sessions',
			addedByAi: true
		},
		{ id: 3, title: 'Bookmark CRUD endpoints', addedByAi: true }
	],
	unused: [{ id: 1, title: 'Set up the database schema' }]
};

describe('formatTaskCreated', () => {
	it('leads with one ✓ line, then aligned dependency rows and one next step', () => {
		expect(lines(formatTaskCreated(exportTask, 80))).toEqual([
			'✓ Added task 4  Export bookmarks as a Netscape HTML file · medium priority',
			'  Depends on  2  Email and password sign-in with sessions  added by AI',
			'              3  Bookmark CRUD endpoints                   added by AI',
			'  Not used    1  Set up the database schema',
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
				dependencies: [{ id: 101, title: long, addedByAi: true }],
				unused: [{ id: 7, title: long }]
			},
			80
		);

		expect(widest(output)).toBeLessThanOrEqual(80);
		expect(lines(output)[0]).toMatch(
			/^✓ Added task 120 {2}A very long.*… · high priority$/
		);
	});

	it('cuts titles and wraps the next step in a narrow terminal', () => {
		const output = formatTaskCreated(exportTask, 50);

		expect(widest(output)).toBeLessThanOrEqual(50);
		expect(lines(output)).toEqual([
			'✓ Added task 4  Export bookmark… · medium priority',
			'  Depends on  2  Email and password…   added by AI',
			'              3  Bookmark CRUD endpo…  added by AI',
			'  Not used    1  Set up the database…',
			'Next: taskgraph show 4 to read it, or taskgraph',
			'      expand --id=4 to break it down'
		]);
	});
});
