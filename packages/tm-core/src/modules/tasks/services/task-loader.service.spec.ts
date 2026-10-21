import { describe, expect, it } from 'vitest';
import type { Subtask, Task } from '../../../common/types/index.js';
import { createSubtask, createTask } from '../../../testing/task-fixtures.js';
import { TaskLoaderService } from './task-loader.service.js';
import type { TaskService } from './task-service.js';

/** A subtask whose dependencies stay as written: a number is a sibling */
const sub = (
	id: number,
	dependencies: Array<string | number> = [],
	status: Subtask['status'] = 'pending'
) =>
	createSubtask({
		id,
		title: `Subtask ${id}`,
		parentId: '5',
		status,
		dependencies
	});

const parent = (subtasks: Subtask[]): Task =>
	createTask({ id: 5, title: 'Parent', subtasks });

const loaderFor = (task: Task) =>
	new TaskLoaderService({ getTask: async () => task } as unknown as TaskService);

describe('TaskLoaderService.loadAndValidateTask', () => {
	it('accepts a bare number naming an existing sibling', async () => {
		const result = await loaderFor(
			parent([sub(1), sub(2, [1])])
		).loadAndValidateTask('5');

		expect(result.success).toBe(true);
	});

	it('flags a bare number naming a sibling that does not exist', async () => {
		const result = await loaderFor(parent([sub(1, [7])])).loadAndValidateTask(
			'5'
		);

		expect(result.errorType).toBe('missing_dependencies');
		expect(result.dependencyIssues?.[0].dependencyRef).toBe('7');
	});

	it('does not read a string without a dot as a sibling', async () => {
		// "2" is task 2, outside this task: it is neither a sibling nor missing
		const result = await loaderFor(
			parent([sub(1), sub(2, ['1'])])
		).loadAndValidateTask('5');

		expect(result.success).toBe(true);
	});

	it('does not see a loop between a subtask and a task of the same number', async () => {
		const result = await loaderFor(
			parent([sub(1, ['2']), sub(2, ['1'])])
		).loadAndValidateTask('5');

		expect(result.success).toBe(true);
	});

	it('still finds a loop between siblings', async () => {
		const result = await loaderFor(
			parent([sub(1, [2]), sub(2, ['5.1'])])
		).loadAndValidateTask('5');

		expect(result.errorType).toBe('circular_dependencies');
	});
});

describe('TaskLoaderService.getExecutionOrder', () => {
	const order = (subtasks: Subtask[]) =>
		loaderFor(parent(subtasks))
			.getExecutionOrder(parent(subtasks))
			.map((st) => st.id);

	it('puts a subtask after the sibling a bare number names', () => {
		expect(order([sub(1, [2]), sub(2)])).toEqual([2, 1]);
	});

	it('does not wait for a sibling when the dependency is a task string', () => {
		expect(order([sub(1, ['2']), sub(2)])).toEqual([1, 2]);
	});
});
