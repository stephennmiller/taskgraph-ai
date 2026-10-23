import { describe, expect, it } from 'vitest';
import { formatClearedSubtasks } from './clear-subtasks-formatters.js';

import {
	HOSTILE,
	sgrFree,
	UNSAFE
} from '../../../tests/helpers/hostile-text.js';

const plain = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, '');

describe('formatClearedSubtasks', () => {
	it('names the task when one was cleared', () => {
		const output = plain(
			formatClearedSubtasks({
				cleared: [{ id: 1, title: 'Set up the database', count: 3 }],
				empty: []
			})
		);

		expect(output.split('\n')).toEqual([
			'✓ Cleared 3 subtasks from task 1',
			'  1  Set up the database',
			'Run taskgraph expand --id=1 to add new ones'
		]);
	});

	it('adds a count column for several tasks and notes the empty ones', () => {
		const output = plain(
			formatClearedSubtasks({
				cleared: [
					{ id: 1, title: 'Set up the database', count: 3 },
					{ id: 12, title: 'Build the login API', count: 1 }
				],
				empty: [{ id: 3, title: 'Write docs' }]
			})
		);

		expect(output.split('\n')).toEqual([
			'✓ Cleared 4 subtasks from 2 tasks',
			'  1   3 subtasks  Set up the database',
			'  12  1 subtask   Build the login API',
			'Task 3 had no subtasks',
			'Run taskgraph expand --id=<id> to add new ones'
		]);
	});

	it('cuts long titles to fit the terminal', () => {
		const output = plain(
			formatClearedSubtasks(
				{
					cleared: [{ id: 1, title: 'A'.repeat(200), count: 2 }],
					empty: []
				},
				40
			)
		);

		const row = output.split('\n')[1];
		expect(row.length).toBeLessThanOrEqual(40);
		expect(row.endsWith('…')).toBe(true);
	});

	it('counts empty tasks instead of listing many', () => {
		const output = plain(
			formatClearedSubtasks({
				cleared: [{ id: 1, title: 'One', count: 1 }],
				empty: [2, 3, 4, 5].map((id) => ({ id, title: `Task ${id}` }))
			})
		);

		expect(output).toContain('4 tasks had no subtasks');
	});

	it('lists up to three empty tasks by ID', () => {
		const output = plain(
			formatClearedSubtasks({
				cleared: [{ id: 1, title: 'One', count: 1 }],
				empty: [2, 3, 4].map((id) => ({ id, title: `Task ${id}` }))
			})
		);

		expect(output).toContain('Tasks 2, 3 and 4 had no subtasks');
	});

	it('says so when the one task asked for has no subtasks', () => {
		expect(
			formatClearedSubtasks({
				cleared: [],
				empty: [{ id: 3, title: 'Write docs' }]
			})
		).toBe('Task 3 has no subtasks');
	});

	it('says so when none of several tasks have subtasks', () => {
		expect(
			formatClearedSubtasks({
				cleared: [],
				empty: [
					{ id: 1, title: 'One' },
					{ id: 2, title: 'Two' }
				]
			})
		).toBe('No subtasks to clear');
	});
});

describe('formatClearedSubtasks with escape sequences in titles', () => {
	it('prints the titles without them', () => {
		const out = sgrFree(
			formatClearedSubtasks({
				cleared: [{ id: 1, title: HOSTILE, count: 1 }],
				empty: [{ id: 2, title: HOSTILE }]
			})
		);

		expect(out).toContain('  1  Fix login');
		expect(out).not.toMatch(UNSAFE);
	});
});
