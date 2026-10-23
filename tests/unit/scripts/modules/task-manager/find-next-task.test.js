/**
 * Tests for the find-next-task.js module
 */
import { vi } from 'vitest';
import findNextTask from '../../../../../scripts/modules/task-manager/find-next-task.js';

describe('findNextTask', () => {
	test('should return the highest priority task with all dependencies satisfied', () => {
		const tasks = [
			{
				id: 1,
				title: 'Setup Project',
				status: 'done',
				dependencies: [],
				priority: 'high'
			},
			{
				id: 2,
				title: 'Implement Core Features',
				status: 'pending',
				dependencies: [1],
				priority: 'high'
			},
			{
				id: 3,
				title: 'Create Documentation',
				status: 'pending',
				dependencies: [1],
				priority: 'medium'
			},
			{
				id: 4,
				title: 'Deploy Application',
				status: 'pending',
				dependencies: [2, 3],
				priority: 'high'
			}
		];

		const nextTask = findNextTask(tasks);

		expect(nextTask).toBeDefined();
		expect(nextTask.id).toBe(2);
		expect(nextTask.title).toBe('Implement Core Features');
	});

	test('should prioritize by priority level when dependencies are equal', () => {
		const tasks = [
			{
				id: 1,
				title: 'Setup Project',
				status: 'done',
				dependencies: [],
				priority: 'high'
			},
			{
				id: 2,
				title: 'Low Priority Task',
				status: 'pending',
				dependencies: [1],
				priority: 'low'
			},
			{
				id: 3,
				title: 'Medium Priority Task',
				status: 'pending',
				dependencies: [1],
				priority: 'medium'
			},
			{
				id: 4,
				title: 'High Priority Task',
				status: 'pending',
				dependencies: [1],
				priority: 'high'
			}
		];

		const nextTask = findNextTask(tasks);

		expect(nextTask.id).toBe(4);
		expect(nextTask.priority).toBe('high');
	});

	test('should return null when all tasks are completed', () => {
		const tasks = [
			{
				id: 1,
				title: 'Setup Project',
				status: 'done',
				dependencies: [],
				priority: 'high'
			},
			{
				id: 2,
				title: 'Implement Features',
				status: 'done',
				dependencies: [1],
				priority: 'high'
			}
		];

		const nextTask = findNextTask(tasks);

		expect(nextTask).toBeNull();
	});

	test('should return null when all pending tasks have unsatisfied dependencies', () => {
		const tasks = [
			{
				id: 1,
				title: 'Setup Project',
				status: 'pending',
				dependencies: [2],
				priority: 'high'
			},
			{
				id: 2,
				title: 'Implement Features',
				status: 'pending',
				dependencies: [1],
				priority: 'high'
			}
		];

		const nextTask = findNextTask(tasks);

		expect(nextTask).toBeNull();
	});

	test('should handle empty tasks array', () => {
		const nextTask = findNextTask([]);

		expect(nextTask).toBeNull();
	});

	test('should consider subtask dependencies when finding next task', () => {
		const tasks = [
			{
				id: 1,
				title: 'Parent Task',
				status: 'in-progress',
				dependencies: [],
				priority: 'high',
				subtasks: [
					{
						id: 1,
						title: 'Subtask 1',
						status: 'done',
						dependencies: []
					},
					{
						id: 2,
						title: 'Subtask 2',
						status: 'pending',
						dependencies: []
					}
				]
			},
			{
				id: 2,
				title: 'Dependent Task',
				status: 'pending',
				dependencies: [1],
				priority: 'high'
			}
		];

		const nextTask = findNextTask(tasks);

		// Task 2 should not be returned because Task 1 is not completely done
		// (it has a pending subtask)
		expect(nextTask).not.toEqual(expect.objectContaining({ id: 2 }));
	});

	describe('subtask dependencies', () => {
		const project = (dependencies) => [
			{
				id: 1,
				title: 'Parent',
				status: 'in-progress',
				dependencies: [],
				// Lower than task 2, so task 2 wins when no subtask is eligible
				priority: 'low',
				subtasks: [
					{ id: 1, title: 'S1', status: 'pending', dependencies },
					{ id: 2, title: 'S2', status: 'done', dependencies: [] }
				]
			},
			{
				id: 2,
				title: 'Other',
				status: 'pending',
				dependencies: [],
				priority: 'medium'
			}
		];

		test('reads a string without a dot as a task, not a sibling', () => {
			// "2" is task 2 (pending), so 1.1 must wait even though sibling 1.2 is done
			const nextTask = findNextTask(project(['2']));

			expect(nextTask.id).toBe(2);
		});

		test('reads a bare number as a sibling subtask', () => {
			const nextTask = findNextTask(project([2]));

			expect(nextTask.id).toBe('1.1');
			expect(nextTask.dependencies).toEqual(['1.2']);
		});

		test('reads a number of 100 or more as a task', () => {
			const tasks = project([100]);
			tasks.push({
				id: 100,
				title: 'Far',
				status: 'done',
				dependencies: [],
				priority: 'low'
			});

			expect(findNextTask(tasks).id).toBe('1.1');
		});
	});

	test('ranks a critical task above a high one, as the CLI does', () => {
		const tasks = [
			{
				id: 1,
				title: 'High',
				status: 'pending',
				dependencies: [],
				priority: 'high'
			},
			{
				id: 2,
				title: 'Critical',
				status: 'pending',
				dependencies: [],
				priority: 'critical'
			}
		];

		expect(findNextTask(tasks).id).toBe(2);
	});

	test('counts a dependency on an archived task as done but still lists it', () => {
		const tasks = [
			{
				id: 3,
				title: 'Waits on archived task 1',
				status: 'in-progress',
				dependencies: [1],
				priority: 'high',
				subtasks: [
					{ id: 1, title: 'Sub', status: 'pending', dependencies: ['1'] }
				]
			}
		];

		const next = findNextTask(tasks, null, new Set(['1']));

		expect(next.id).toBe('3.1');
		expect(next.dependencies).toEqual(['1']);
		expect(findNextTask(tasks)).toBeNull();
	});
});
