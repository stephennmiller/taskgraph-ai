import { describe, expect, it } from 'vitest';
import type { Task } from '../../../common/types/index.js';
import { TaskExecutionService } from './task-execution-service.js';
import type { TaskService } from './task-service.js';

const task = (id: string, status: Task['status'], subtaskIds: number[] = []) =>
	({
		id,
		title: `Task ${id}`,
		description: '',
		details: '',
		testStrategy: '',
		status,
		priority: 'medium',
		dependencies: [],
		subtasks: subtaskIds.map((sid) => ({
			id: sid,
			parentId: id,
			title: `Subtask ${id}.${sid}`,
			description: '',
			details: '',
			status: 'pending',
			dependencies: []
		}))
	}) as unknown as Task;

/** Task 2 is in progress; task 3 is pending with one subtask */
function service(): TaskExecutionService {
	const tasks = [task('2', 'in-progress', [1]), task('3', 'pending', [1])];
	const taskService = {
		getTask: async (id: string) =>
			tasks.find((t) => String(t.id) === id) ?? null,
		getTaskList: async () => ({ tasks })
	} as unknown as TaskService;
	return new TaskExecutionService(taskService);
}

describe('TaskExecutionService.startTask', () => {
	it('reports a missing task as missing, not as a conflict', async () => {
		const result = await service().startTask('99', { dryRun: true });

		expect(result.found).toBe(false);
		expect(result.error).toBe('Task 99 not found');
	});

	it('reports a missing subtask instead of starting its parent', async () => {
		const result = await service().startTask('3.9', {
			dryRun: true,
			force: true
		});

		expect(result.found).toBe(false);
		expect(result.started).toBe(false);
		expect(result.error).toBe('Subtask 3.9 not found');
	});

	it('still reports a conflict for an existing task', async () => {
		const result = await service().startTask('3', { dryRun: true });

		expect(result.found).toBe(false);
		expect(result.error).toMatch(/^Conflicting tasks in progress: #2/);
	});

	it('starts a subtask of the task in progress', async () => {
		const result = await service().startTask('2.1', { dryRun: true });

		expect(result.found).toBe(true);
		expect(result.started).toBe(true);
		expect(result.subtask?.id).toBe(1);
	});
});
