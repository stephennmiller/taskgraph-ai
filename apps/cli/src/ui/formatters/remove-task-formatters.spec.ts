import type { TaskRemovalPreview } from '@tm/core';
import { describe, expect, it } from 'vitest';
import {
	formatRemovalPlan,
	formatRemovalQuestion,
	formatTasksRemoved
} from './remove-task-formatters.js';

const plain = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, '');

describe('formatTasksRemoved', () => {
	it('names one task', () => {
		expect(plain(formatTasksRemoved(['2']))).toBe('✓ Removed task 2');
	});

	it('names one subtask', () => {
		expect(plain(formatTasksRemoved(['5.1']))).toBe('✓ Removed subtask 5.1');
	});

	it('counts and lists several', () => {
		expect(plain(formatTasksRemoved(['2', '5.1', '7']))).toBe(
			'✓ Removed 3 tasks: 2, 5.1, 7'
		);
	});

	it('points to fix-dependencies when tasks depend on missing tasks', () => {
		expect(plain(formatTasksRemoved(['2'], 2))).toBe(
			'✓ Removed task 2\n2 tasks depend on missing tasks. Run: taskgraph fix-dependencies'
		);
		expect(plain(formatTasksRemoved(['2'], 1, 'feature')).split('\n')[1]).toBe(
			'1 task depends on missing tasks. Run: taskgraph fix-dependencies --tag feature'
		);
	});
});

describe('formatRemovalPlan (#1146)', () => {
	const preview = (
		found: TaskRemovalPreview['found'],
		dependents: TaskRemovalPreview['dependents'] = []
	): TaskRemovalPreview => ({
		found,
		missing: [],
		subtaskCount: 0,
		dependents
	});

	it('cuts a long title to the width and strips escape codes', () => {
		const out = plain(
			formatRemovalPlan(
				preview([
					{
						id: '3',
						title: `Add a rate \x1b[2Jlimiter to the login endpoint so brute force attempts are slowed down considerably`
					},
					{ id: '5.2', title: 'Short', parent: { id: '5', title: 'Parent' } }
				]),
				80
			)
		).split('\n');

		expect(out[0]).toMatch(/^ {2}3 {4}Add a rate limiter to the login .*…$/);
		expect(out[0]).not.toContain('\x1b');
		expect(out[1]).toBe('  5.2  Short');
		for (const line of out) expect(line.length).toBeLessThanOrEqual(80);
	});

	it('says who loses a dependency, once each, leaving out those removed too', () => {
		const out = plain(
			formatRemovalPlan(
				preview(
					[
						{ id: '3', title: 'A' },
						{ id: '4', title: 'B' }
					],
					[
						{ id: '3', dependentIds: ['4', '6', '7'] },
						{ id: '4', dependentIds: ['7'] }
					]
				),
				80
			)
		).split('\n');

		expect(out[2]).toBe('Tasks 6, 7 depend on them and lose that dependency');
	});
});

describe('formatRemovalQuestion (#1146)', () => {
	const task = (id: string) => ({ id, title: 'T' });
	const subtask = (id: string) => ({
		id,
		title: 'S',
		parent: { id: '5', title: 'P' }
	});

	it.each([
		[[task('3')], 0, 'Delete task 3?'],
		[[task('3')], 1, 'Delete task 3 and its subtask?'],
		[[task('3')], 2, 'Delete task 3 and its 2 subtasks?'],
		[[task('3'), task('4')], 3, 'Delete 2 tasks and their 3 subtasks?'],
		[[subtask('5.2')], 0, 'Delete subtask 5.2?'],
		[[subtask('5.1'), subtask('5.2')], 0, 'Delete 2 subtasks?'],
		[[task('3'), subtask('5.2')], 2, 'Delete task 3 and 3 subtasks?']
	])('%j with %i subtasks asks "%s"', (found, subtaskCount, question) => {
		expect(
			formatRemovalQuestion({
				found,
				missing: [],
				subtaskCount,
				dependents: []
			})
		).toBe(`${question} This can't be undone.`);
	});
});
