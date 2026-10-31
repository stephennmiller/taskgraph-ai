import { describe, expect, it } from 'vitest';
import {
	formatSubtaskAdded,
	formatSubtaskRemoved
} from './subtask-change-formatters.js';

const plain = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, '');

describe('formatSubtaskAdded', () => {
	it('leads with the new ID and title, then one next step', () => {
		const output = plain(
			formatSubtaskAdded(
				1,
				{
					id: 3,
					title: 'Write the migration',
					status: 'pending',
					dependencies: []
				},
				undefined,
				80
			)
		);

		expect(output.split('\n')).toEqual([
			'✓ Added subtask 1.3  Write the migration',
			'Next: taskgraph set-status 1.3 in-progress'
		]);
	});

	it('adds the dependencies and a status other than pending as a muted line', () => {
		const output = plain(
			formatSubtaskAdded(
				1,
				{
					id: 3,
					title: 'Write the migration',
					status: 'in-progress',
					dependencies: ['1.1', 2]
				},
				undefined,
				80
			)
		);

		expect(output.split('\n')).toEqual([
			'✓ Added subtask 1.3  Write the migration',
			'  in-progress · depends on 1.1, 2'
		]);
	});

	it('says which task became the subtask', () => {
		expect(
			plain(formatSubtaskAdded(1, { id: 4, title: 'Write docs' }, '3', 80))
		).toBe('✓ Task 3 is now subtask 1.4  Write docs');
	});

	it.each([80, 40])('cuts a long title to fit %i columns', (width) => {
		const lines = plain(
			formatSubtaskAdded(
				12,
				{ id: 10, title: 'A'.repeat(200) },
				undefined,
				width
			)
		).split('\n');

		expect(lines[0].length).toBeLessThanOrEqual(width);
		expect(lines[0].endsWith('…')).toBe(true);
		for (const line of lines) expect(line.length).toBeLessThanOrEqual(80);
	});
});

describe('formatSubtaskRemoved', () => {
	it('confirms a deleted subtask in one line', () => {
		expect(plain(formatSubtaskRemoved('1.1', null))).toBe(
			'✓ Removed subtask 1.1'
		);
	});

	it('names the task a converted subtask became', () => {
		expect(
			plain(formatSubtaskRemoved('1.2', { id: 4, title: 'Add indexes' }, 80))
		).toBe('✓ Subtask 1.2 is now task 4  Add indexes');
	});

	it('strips escape sequences from the typed ID', () => {
		expect(formatSubtaskRemoved('1.1\x1b]0;pwned\x07', null)).not.toContain(
			'\x1b]'
		);
	});

	it('cuts a long title to fit narrow terminals', () => {
		const line = plain(
			formatSubtaskRemoved('1.2', { id: 4, title: 'B'.repeat(200) }, 40)
		);
		expect(line.length).toBeLessThanOrEqual(40);
	});
});
