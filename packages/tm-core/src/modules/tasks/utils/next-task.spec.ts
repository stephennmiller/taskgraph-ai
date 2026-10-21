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

	it('orders ids numerically, so 2 comes before 10', () => {
		const next = selectNextTask([
			createTask({ id: 10, title: 'Ten' }),
			createTask({ id: 2, title: 'Two' })
		]);

		expect(next?.id).toBe('2');
	});
});
