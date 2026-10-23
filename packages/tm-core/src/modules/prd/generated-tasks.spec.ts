import { describe, expect, it } from 'vitest';
import {
	formatExistingTaskList,
	numberGeneratedTasks
} from './generated-tasks.js';

const raw = (id: number, dependencies: number[] = []) => ({ id, dependencies });

describe('numberGeneratedTasks', () => {
	it('numbers tasks from startId in the order the model returned them', () => {
		const result = numberGeneratedTasks([raw(1), raw(2, [1]), raw(3, [1, 2])], {
			promptStartId: 1,
			startId: 1,
			existingIds: []
		});

		expect(result).toEqual([
			{ id: 1, dependencies: [] },
			{ id: 2, dependencies: [1] },
			{ id: 3, dependencies: [1, 2] }
		]);
	});

	it('keeps a dependency on an existing task below promptStartId', () => {
		// Tag has tasks 1-10; the model numbered the new tasks from 11
		const result = numberGeneratedTasks([raw(11, [3]), raw(12, [11, 5])], {
			promptStartId: 11,
			startId: 11,
			existingIds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
		});

		expect(result).toEqual([
			{ id: 11, dependencies: [3] },
			{ id: 12, dependencies: [11, 5] }
		]);
	});

	it('renumbers new tasks without moving dependencies on existing tasks', () => {
		// Task 11 was added while the model ran, so the new tasks start at 12
		const result = numberGeneratedTasks([raw(11, [3]), raw(12, [11, 3])], {
			promptStartId: 11,
			startId: 12,
			existingIds: [1, 2, 3, 11]
		});

		expect(result).toEqual([
			{ id: 12, dependencies: [3] },
			{ id: 13, dependencies: [12, 3] }
		]);
	});

	it('reads every ID as a new task when the model numbered from 1', () => {
		const result = numberGeneratedTasks([raw(1), raw(2, [1]), raw(3, [2])], {
			promptStartId: 11,
			startId: 11,
			existingIds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
		});

		expect(result).toEqual([
			{ id: 11, dependencies: [] },
			{ id: 12, dependencies: [11] },
			{ id: 13, dependencies: [12] }
		]);
	});

	it('maps a model ID from 1 to the new task when no existing task has it', () => {
		const result = numberGeneratedTasks([raw(1), raw(2, [1])], {
			promptStartId: 4,
			startId: 4,
			existingIds: [2, 3]
		});

		expect(result[1]).toEqual({ id: 5, dependencies: [4] });
	});

	it('drops a dependency on a task that is gone, unknown, or not lower', () => {
		const result = numberGeneratedTasks([raw(4, [2, 9, 5]), raw(5, [5])], {
			promptStartId: 4,
			startId: 4,
			// Task 2 was deleted while the model ran
			existingIds: [1, 3]
		});

		expect(result).toEqual([
			{ id: 4, dependencies: [] },
			{ id: 5, dependencies: [] }
		]);
	});

	it('lists each dependency once', () => {
		const result = numberGeneratedTasks([raw(3), raw(4, [1, 3, 1, 3])], {
			promptStartId: 3,
			startId: 3,
			existingIds: ['1', '2']
		});

		expect(result[1].dependencies).toEqual([1, 3]);
	});
});

describe('formatExistingTaskList', () => {
	it('lists each task as its ID and title, one per line', () => {
		expect(
			formatExistingTaskList([
				{ id: 1, title: 'Set up the repo' },
				{ id: 2, title: 'Add  login\nform' }
			])
		).toBe('- 1: Set up the repo\n- 2: Add login form');
	});

	it('keeps the highest IDs and says how many were left out', () => {
		const tasks = Array.from({ length: 5 }, (_, i) => ({
			id: i + 1,
			title: `Task ${i + 1}`
		}));

		expect(formatExistingTaskList(tasks, 2)).toBe(
			'- 4: Task 4\n- 5: Task 5\n(3 earlier tasks not listed)'
		);
	});

	it('is empty for a tag with no tasks', () => {
		expect(formatExistingTaskList([])).toBe('');
	});
});
