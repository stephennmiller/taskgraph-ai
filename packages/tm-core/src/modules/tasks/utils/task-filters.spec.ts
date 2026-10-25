import { describe, expect, it } from 'vitest';
import { createSubtask, createTask } from '../../../testing/task-fixtures.js';
import {
	buildBlocksMap,
	filterByStatus,
	filterReadyTasks
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
