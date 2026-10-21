import isTaskDependentOn from '../../../../../scripts/modules/task-manager/is-task-dependent.js';

describe('isTaskDependentOn', () => {
	test('finds a dependency stored as a string, as tm-core stores task IDs', () => {
		const tasks = [
			{ id: '1', dependencies: [] },
			{ id: '2', dependencies: ['1'] }
		];

		expect(isTaskDependentOn(tasks, tasks[1], 1)).toBe(true);
	});

	test('follows a chain of string dependencies', () => {
		const tasks = [
			{ id: '1', dependencies: [] },
			{ id: '2', dependencies: ['1'] },
			{ id: '3', dependencies: ['2'] }
		];

		expect(isTaskDependentOn(tasks, tasks[2], 1)).toBe(true);
	});

	test('reads a bare number on a subtask as a sibling, not as the task', () => {
		const task = {
			id: 3,
			dependencies: [],
			subtasks: [{ id: 1 }, { id: 2, dependencies: [1] }]
		};

		expect(isTaskDependentOn([task], task, 1)).toBe(false);
	});

	test('reads a string on a subtask as a task', () => {
		const task = {
			id: 3,
			dependencies: [],
			subtasks: [{ id: 1, dependencies: ['1'] }]
		};

		expect(isTaskDependentOn([task], task, 1)).toBe(true);
	});

	test('finds a subtask whose parent is the target', () => {
		expect(isTaskDependentOn([], { id: 1, parentTaskId: 5 }, 5)).toBe(true);
	});
});
