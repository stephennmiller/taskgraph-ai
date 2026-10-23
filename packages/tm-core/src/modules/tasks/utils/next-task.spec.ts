import { describe, expect, it } from 'vitest';
import { createSubtask, createTask } from '../../../testing/task-fixtures.js';
import { selectNextTask } from './next-task.js';

describe('selectNextTask', () => {
	it('ranks critical above high', () => {
		const next = selectNextTask([
			createTask({ id: 1, title: 'High', priority: 'high' }),
			createTask({ id: 2, title: 'Critical', priority: 'critical' })
		]);

		expect(next?.id).toBe('2');
	});

	it('treats a completed task as satisfying a dependency', () => {
		const next = selectNextTask([
			createTask({ id: 1, title: 'Old', status: 'completed' as never }),
			createTask({ id: 2, title: 'Waiting', dependencies: ['1'] })
		]);

		expect(next?.id).toBe('2');
	});

	it('treats a cancelled task as satisfying a dependency', () => {
		const next = selectNextTask([
			createTask({ id: 1, title: 'Dropped', status: 'cancelled' }),
			createTask({ id: 2, title: 'Waiting', dependencies: ['1'] })
		]);

		expect(next?.id).toBe('2');
	});

	it('treats a cancelled subtask as satisfying a sibling dependency', () => {
		const next = selectNextTask([
			createTask({
				id: 1,
				title: 'Parent',
				status: 'in-progress',
				subtasks: [
					createSubtask({
						id: 1,
						title: 'Dropped',
						parentId: '1',
						status: 'cancelled'
					}),
					createSubtask({
						id: 2,
						title: 'Waiting',
						parentId: '1',
						dependencies: [1]
					})
				]
			})
		]);

		expect(next?.id).toBe('1.2');
	});

	it('treats a completed subtask as satisfying a sibling dependency', () => {
		const next = selectNextTask([
			createTask({
				id: 1,
				title: 'Parent',
				status: 'in-progress',
				subtasks: [
					createSubtask({
						id: 1,
						title: 'Done one',
						parentId: '1',
						status: 'completed' as never
					}),
					createSubtask({
						id: 2,
						title: 'Waiting',
						parentId: '1',
						dependencies: [1]
					})
				]
			})
		]);

		expect(next?.id).toBe('1.2');
	});

	it('returns null when nothing is eligible', () => {
		expect(selectNextTask([createTask({ id: 1, title: 'x', status: 'done' })])).toBeNull();
	});

	it('treats a task with no status as pending', () => {
		const next = selectNextTask([
			{ ...createTask({ id: 1, title: 'No status' }), status: undefined as never }
		]);

		expect(next?.id).toBe('1');
	});

	it('prefers a subtask of an in-progress task over a higher-priority task', () => {
		const next = selectNextTask([
			createTask({ id: 1, title: 'Urgent', priority: 'critical' }),
			createTask({
				id: 2,
				title: 'Started',
				status: 'in-progress',
				priority: 'low',
				subtasks: [createSubtask({ id: 1, title: 'Step', parentId: '2' })]
			})
		]);

		expect(next?.id).toBe('2.1');
	});

	it('skips subtasks whose parent still waits on an unfinished task', () => {
		const next = selectNextTask([
			createTask({ id: 1, title: 'Database', status: 'review' }),
			createTask({
				id: 2,
				title: 'Started early',
				status: 'in-progress',
				dependencies: ['1'],
				subtasks: [createSubtask({ id: 1, title: 'Step', parentId: '2' })]
			}),
			createTask({ id: 3, title: 'Ready' })
		]);

		expect(next?.id).toBe('3');
	});

	it('offers subtasks once the parent\'s dependencies are done', () => {
		const next = selectNextTask([
			createTask({ id: 1, title: 'Database', status: 'done' }),
			createTask({
				id: 2,
				title: 'Started',
				status: 'in-progress',
				dependencies: ['1', '2.2'],
				subtasks: [
					createSubtask({ id: 1, title: 'Step', parentId: '2' }),
					createSubtask({ id: 2, title: 'Later', parentId: '2' })
				]
			})
		]);

		// The parent's dependency on its own subtask doesn't hold its subtasks
		// back; 2.2 comes first because task 2 waits on it
		expect(next?.id).toBe('2.2');
	});

	it('offers subtasks when the parent lists itself as a dependency', () => {
		const next = selectNextTask([
			createTask({
				id: 2,
				title: 'Lists itself',
				status: 'in-progress',
				dependencies: ['2'],
				subtasks: [createSubtask({ id: 1, title: 'Step', parentId: '2' })]
			})
		]);

		// The graph ignores a self-dependency, so `why 2.1` says not blocked
		expect(next?.id).toBe('2.1');
	});

	it('orders ids numerically, so 2 comes before 10', () => {
		const next = selectNextTask([
			createTask({ id: 10, title: 'Ten' }),
			createTask({ id: 2, title: 'Two' })
		]);

		expect(next?.id).toBe('2');
	});
});
