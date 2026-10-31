import { describe, expect, it } from 'vitest';
import type { Task } from '../../../common/types/index.js';
import { createSubtask, createTask } from '../../../testing/task-fixtures.js';
import {
	buildBlocksMap,
	filterByAssignee,
	filterByStatus,
	filterReadyTasks,
	parseStatusFilter
} from './task-filters.js';

describe('filterByStatus', () => {
	const tasks = [
		createTask({ id: 1, title: 'Task 1', status: 'done' }),
		createTask({ id: 2, title: 'Task 2', status: 'pending' }),
		createTask({ id: 3, title: 'Task 3', status: 'review' })
	];
	const ids = (filtered: typeof tasks) => filtered.map((task) => task.id);

	it('keeps every task for no status or all', () => {
		expect(ids(filterByStatus(tasks))).toEqual(['1', '2', '3']);
		expect(ids(filterByStatus(tasks, 'all'))).toEqual(['1', '2', '3']);
	});

	it('keeps the tasks with one of the listed statuses', () => {
		expect(ids(filterByStatus(tasks, 'pending'))).toEqual(['2']);
		expect(ids(filterByStatus(tasks, 'pending, review'))).toEqual(['2', '3']);
	});
});

describe('a dependency on a subtask (#657)', () => {
	const tasks = [
		createTask({
			id: 1,
			title: 'Parent',
			status: 'review',
			subtasks: [
				createSubtask({ id: 1, title: 'Sub', parentId: '1', status: 'done' })
			]
		}),
		createTask({ id: 2, title: 'Waiting', dependencies: ['1.1', '1.9'] })
	];

	it('is not reported as a non-existent task', () => {
		expect(buildBlocksMap(tasks).invalidDependencies).toEqual([
			{ taskId: '2', depId: '1.9' }
		]);
	});

	it('counts toward --ready once the subtask is done', () => {
		const withBlocks = [
			{ ...tasks[0], blocks: [] },
			{ ...tasks[1], dependencies: ['1.1'], blocks: [] }
		];

		expect(filterReadyTasks(withBlocks).map((task) => task.id)).toEqual([
			'1',
			'2'
		]);
	});
});

describe('parseStatusFilter', () => {
	it('gives no statuses for no value or all', () => {
		expect(parseStatusFilter()).toBeUndefined();
		expect(parseStatusFilter('all')).toBeUndefined();
	});

	it('splits and trims the listed statuses', () => {
		expect(parseStatusFilter('pending, review')).toEqual(['pending', 'review']);
	});

	it('refuses an unknown status, naming the valid ones', () => {
		expect(() => parseStatusFilter('pending,bogus')).toThrow(
			'"bogus" isn\'t a status. Use one of: pending, in-progress'
		);
	});
});

describe('filterByAssignee', () => {
	it('keeps tasks assigned to the login, or with a subtask assigned to it', () => {
		const tasks = [
			{ id: '1', assignee: 'Octocat', subtasks: [] },
			{ id: '2', subtasks: [{ id: '1', assignee: 'octocat' }] },
			{ id: '3', assignee: 'hubot', subtasks: [] }
		] as unknown as Task[];

		expect(filterByAssignee(tasks, 'octocat').map((t) => t.id)).toEqual([
			'1',
			'2'
		]);
		expect(filterByAssignee(tasks)).toHaveLength(3);
	});
});
