import { describe, expect, it } from 'vitest';
import type { Task } from '../../../common/types/index.js';
import { createSubtask, createTask } from '../../../testing/task-fixtures.js';
import { normalizeTaskStatus, normalizeTaskStatuses } from './legacy-status.js';

describe('normalizeTaskStatus', () => {
	it("reads 'completed' as 'done'", () => {
		expect(normalizeTaskStatus('completed')).toBe('done');
	});

	it('leaves every other value alone, unknown or missing included', () => {
		expect(normalizeTaskStatus('pending')).toBe('pending');
		expect(normalizeTaskStatus('finished')).toBe('finished');
		expect(normalizeTaskStatus(undefined)).toBeUndefined();
	});
});

describe('normalizeTaskStatuses', () => {
	it("reads 'completed' as 'done' on tasks and subtasks without changing the input", () => {
		const input: Task[] = [
			createTask({
				id: '1',
				title: 'Schema',
				status: 'completed' as never,
				subtasks: [
					createSubtask({ id: 1, parentId: '1', title: 'A', status: 'completed' as never }),
					createSubtask({ id: 2, parentId: '1', title: 'B', status: 'pending' })
				]
			}),
			createTask({ id: '2', title: 'API', status: 'review' })
		];

		const result = normalizeTaskStatuses(input);

		expect(result.map((t) => t.status)).toEqual(['done', 'review']);
		expect(result[0].subtasks.map((s) => s.status)).toEqual([
			'done',
			'pending'
		]);
		expect(input[0].status).toBe('completed');
		expect(input[0].subtasks[0].status).toBe('completed');
	});

	it('leaves entries that are not objects for validation to report', () => {
		const input = [null, createTask({ id: '1', title: 'A', status: 'completed' as never })];

		const result = normalizeTaskStatuses(input as unknown as Task[]);

		expect(result[0]).toBeNull();
		expect(result[1].status).toBe('done');
	});
});
