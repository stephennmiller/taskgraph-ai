import { describe, expect, it } from 'vitest';
import { createTask } from '../../../testing/task-fixtures.js';
import { filterByStatus } from './task-filters.js';

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
