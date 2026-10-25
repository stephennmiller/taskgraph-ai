import { describe, expect, it } from 'vitest';
import { createTask } from '../../../testing/task-fixtures.js';
import { filterByStatus, parseStatusFilter } from './task-filters.js';

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
