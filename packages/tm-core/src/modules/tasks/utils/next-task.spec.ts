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
});
