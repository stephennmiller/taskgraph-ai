import { describe, expect, it } from 'vitest';
import type { Task } from '../../../common/types/index.js';
import { createSubtask, createTask } from '../../../testing/task-fixtures.js';
import type { ConfigManager } from '../../config/managers/config-manager.js';
import { TaskService } from './task-service.js';

/** A TaskService whose storage returns exactly these tasks (and archive) */
const serviceWith = (
	tasks: Task[],
	archivedIds: string[] = []
): TaskService => {
	const service = new TaskService({
		getActiveTag: () => 'master'
	} as unknown as ConfigManager);
	(service as any).storage = {
		loadTasks: async () => tasks,
		loadArchivedTaskIds: async () => new Set(archivedIds)
	};
	return service;
};

const task = (
	id: number,
	overrides: Partial<Omit<Task, 'id' | 'title'>> = {}
): Task => createTask({ id, title: `Task ${id}`, ...overrides });

/** Dependencies stay as written: a number names a sibling, a string a task */
const subtask = (
	id: number,
	overrides: Partial<Parameters<typeof createSubtask>[0]> = {}
) => createSubtask({ id, title: `Subtask ${id}`, parentId: '1', ...overrides });

const nextId = async (tasks: Task[]) =>
	(await serviceWith(tasks).getNextTask())?.id;

describe('TaskService.getNextTask', () => {
	it('treats a dependency on an archived task as done, and still shows it', async () => {
		const service = serviceWith([task(2, { dependencies: ['1'] })], ['1']);

		const next = await service.getNextTask();

		expect(next?.id).toBe('2');
		expect(next?.dependencies).toEqual(['1']);
	});

	it('shows a subtask\'s dependency on an archived task in full', async () => {
		const service = serviceWith(
			[
				task(2, {
					status: 'in-progress',
					subtasks: [subtask(1, { parentId: '2', dependencies: ['1'] })]
				})
			],
			['1']
		);

		const next = await service.getNextTask();

		expect(next?.id).toBe('2.1');
		expect(next?.dependencies).toEqual(['1']);
	});

	describe('top-level tasks', () => {
		it('prefers the task that unblocks more work among equal priorities', async () => {
			const id = await nextId([
				task(1),
				task(2),
				task(3, { dependencies: ['2'] }),
				task(4, { dependencies: ['2'] })
			]);

			expect(id).toBe('2');
		});

		it('counts transitive dependents', async () => {
			// 2 unblocks 3, 4, 5 (two of them only via 3); 1 unblocks only 6
			const id = await nextId([
				task(1),
				task(2),
				task(3, { dependencies: ['2'] }),
				task(4, { dependencies: ['3'] }),
				task(5, { dependencies: ['3'] }),
				task(6, { dependencies: ['1'] })
			]);

			expect(id).toBe('2');
		});

		it('counts dependents in statuses next would never pick', async () => {
			const id = await nextId([
				task(1),
				task(2),
				task(3, { dependencies: ['2'], status: 'blocked' })
			]);

			expect(id).toBe('2');
		});

		it('still ranks priority above blocked count', async () => {
			const id = await nextId([
				task(1, { priority: 'high' }),
				task(2),
				task(3, { dependencies: ['2'] }),
				task(4, { dependencies: ['2'] })
			]);

			expect(id).toBe('1');
		});

		it('ranks blocked count above dependency count', async () => {
			// 2 has a dependency but unblocks 3; 1 has none and unblocks nothing
			const id = await nextId([
				task(9, { status: 'done' }),
				task(1),
				task(2, { dependencies: ['9'] }),
				task(3, { dependencies: ['2'] })
			]);

			expect(id).toBe('2');
		});

		it('does not change which tasks are eligible', async () => {
			// 1 is in review, so its done subtask does not satisfy 2's dependency
			const id = await nextId([
				task(1, {
					status: 'review',
					subtasks: [subtask(1, { status: 'done' })]
				}),
				task(2, { dependencies: ['1.1'] })
			]);

			expect(id).toBeUndefined();
		});

		it('falls back to fewest dependencies when blocked counts tie', async () => {
			const id = await nextId([
				task(1, { status: 'done' }),
				task(2, { dependencies: ['1'] }),
				task(3)
			]);

			expect(id).toBe('3');
		});

		it('falls back to lowest ID when everything else ties', async () => {
			expect(await nextId([task(7), task(5), task(6)])).toBe('5');
		});

		it('does not count finished tasks that depend on it', async () => {
			const id = await nextId([
				task(1),
				task(2),
				task(3, { dependencies: ['1'], status: 'done' }),
				task(4, { dependencies: ['1'], status: 'done' }),
				task(5, { dependencies: ['2'] })
			]);

			expect(id).toBe('2');
		});
	});

	describe('subtasks of an in-progress task', () => {
		it('prefers the subtask that unblocks more work', async () => {
			const id = await nextId([
				task(1, {
					status: 'in-progress',
					subtasks: [
						subtask(1),
						subtask(2),
						subtask(3, { dependencies: [2] }),
						subtask(4, { dependencies: [2] })
					]
				})
			]);

			expect(id).toBe('1.2');
		});

		it('ranks blocked count above dependency count', async () => {
			// 1.3 has a dependency but unblocks 1.4; 1.2 has none and unblocks nothing
			const id = await nextId([
				task(1, {
					status: 'in-progress',
					subtasks: [
						subtask(1, { status: 'done' }),
						subtask(2),
						subtask(3, { dependencies: [1] }),
						subtask(4, { dependencies: [3] })
					]
				})
			]);

			expect(id).toBe('1.3');
		});

		it('still ranks priority above blocked count', async () => {
			const id = await nextId([
				task(1, {
					status: 'in-progress',
					subtasks: [
						subtask(1, { priority: 'high' }),
						subtask(2),
						subtask(3, { dependencies: [2] })
					]
				})
			]);

			expect(id).toBe('1.1');
		});

		it('reads a string dependency without a dot as a task, not a sibling', async () => {
			// "2" is task 2 (pending), so 1.2 waits; sibling 1.2 being done must not count
			const id = await nextId([
				task(1, {
					status: 'in-progress',
					subtasks: [
						subtask(1, { dependencies: ['2'] }),
						subtask(2, { status: 'done' })
					]
				}),
				task(2)
			]);

			expect(id).toBe('2');
		});

		it('is unblocked by a finished task named with a string dependency', async () => {
			const id = await nextId([
				task(1, {
					status: 'in-progress',
					subtasks: [subtask(1, { dependencies: ['2'] })]
				}),
				task(2, { status: 'done' })
			]);

			expect(id).toBe('1.1');
		});

		it('falls back to lowest ID when blocked counts tie', async () => {
			const id = await nextId([
				task(1, {
					status: 'in-progress',
					subtasks: [subtask(2), subtask(1)]
				})
			]);

			expect(id).toBe('1.1');
		});
	});
});

describe('TaskService.getTask', () => {
	/** A TaskService whose storage returns this task as tasks.json stores it */
	const serviceLoading = (stored: unknown): TaskService => {
		const service = new TaskService({
			getActiveTag: () => 'master'
		} as unknown as ConfigManager);
		(service as any).storage = { loadTask: async () => stored };
		return service;
	};

	// Regression: #311, show returned numeric IDs where list and next give strings
	it('gives IDs as strings, as getTaskList does', async () => {
		const service = serviceLoading({
			...task(2),
			id: 2,
			dependencies: [1],
			subtasks: [{ id: 1, title: 'Schema', status: 'pending', dependencies: [] }]
		});

		const loaded = await service.getTask('2');

		expect(loaded?.id).toBe('2');
		expect(loaded?.dependencies).toEqual(['1']);
		expect(loaded?.subtasks[0].id).toBe('1');
		expect(loaded?.subtasks[0].parentId).toBe('2');
	});

	it('returns null for a task that does not exist', async () => {
		const loaded = await serviceLoading(null).getTask('9');

		expect(loaded).toBeNull();
	});
});
