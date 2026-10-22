import { stripVTControlCharacters } from 'node:util';
import { describe, expect, it } from 'vitest';
import { formatExpandAll } from './expand-all-formatters.js';

const plain = (text: string) => stripVTControlCharacters(text);

const run = {
	expandedCount: 0,
	skippedCount: 0,
	failedCount: 0,
	tasksToExpand: 0
};

describe('formatExpandAll', () => {
	it('leads with the count and leaves out zeros', () => {
		expect(
			plain(formatExpandAll({ ...run, expandedCount: 3, tasksToExpand: 3 }))
		).toBe('✓ Expanded 3 tasks\nNext: taskgraph next');
	});

	it('adds skipped and failed counts as muted facts', () => {
		const [line] = plain(
			formatExpandAll({
				expandedCount: 1,
				skippedCount: 1,
				failedCount: 1,
				tasksToExpand: 3
			})
		).split('\n');

		expect(line).toBe('✓ Expanded 1 task · 1 skipped · 1 failed');
	});

	it('reports a run where every task failed with ✗', () => {
		expect(
			plain(formatExpandAll({ ...run, failedCount: 2, tasksToExpand: 2 }))
		).toBe("✗ Couldn't expand 2 tasks");
	});

	it('explains a run where the complexity report skipped every task', () => {
		expect(
			plain(formatExpandAll({ ...run, skippedCount: 2, tasksToExpand: 2 }))
		).toBe(
			'No tasks expanded · 2 skipped by the complexity report\nAdd --num=<n> to expand them anyway'
		);
	});

	it('suggests --force when every pending task already has subtasks', () => {
		expect(plain(formatExpandAll({ ...run, alreadyExpandedCount: 3 }))).toBe(
			'No pending tasks to expand: 3 already have subtasks\nAdd --force to replace their subtasks'
		);
	});

	it('says only that there is nothing to do when no task is pending', () => {
		expect(formatExpandAll(run)).toBe('No pending tasks to expand');
	});

	it.each([
		{
			expandedCount: 120,
			skippedCount: 30,
			failedCount: 4,
			tasksToExpand: 154
		},
		{ ...run, failedCount: 154, skippedCount: 30, tasksToExpand: 184 },
		{ ...run, skippedCount: 154, tasksToExpand: 154 },
		{ ...run, alreadyExpandedCount: 154 }
	])('fits a 60-column terminal with no box (%o)', (summary) => {
		const output = plain(formatExpandAll(summary));

		for (const line of output.split('\n')) {
			expect(line.length).toBeLessThanOrEqual(60);
		}
		expect(output).not.toMatch(/[╭╮╰╯│]/);
	});
});
