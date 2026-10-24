import { describe, expect, it } from 'vitest';
import type { Subtask } from '../../../common/types/index.js';
import { createTask } from '../../../testing/task-fixtures.js';
import { selectNextTask } from './next-task.js';
import { subtaskInContext } from './subtask-context.js';

// As expand and add-subtask store them: no parentId, often no priority
const stored = (fields: Partial<Subtask> = {}) =>
	({
		id: 2,
		title: 'Cycle reporting',
		status: 'in-progress',
		dependencies: [1],
		...fields
	}) as Subtask;

describe('subtaskInContext', () => {
	it("adds the parent's ID and takes the parent's priority when it has none", () => {
		const parent = createTask({ id: 3, title: 'Cycles', priority: 'high' });

		const subtask = subtaskInContext(parent, stored());

		expect(subtask.parentId).toBe('3');
		expect(subtask.priority).toBe('high');
		expect(subtask.dependencies).toEqual([1]);
	});

	it('keeps a priority of its own', () => {
		const parent = createTask({ id: 3, title: 'Cycles', priority: 'high' });

		expect(subtaskInContext(parent, stored({ priority: 'low' })).priority).toBe(
			'low'
		);
	});

	it('gives a hand-edited subtask with no title or status the ones next shows', () => {
		const sub = stored({
			title: undefined,
			status: undefined,
			dependencies: []
		});
		const parent = createTask({
			id: 3,
			title: 'Cycles',
			status: 'in-progress',
			subtasks: [sub]
		});

		const next = selectNextTask([parent]) as unknown as Subtask;

		expect(next).toMatchObject({ title: 'Subtask 2', status: 'pending' });
		expect(subtaskInContext(parent, sub)).toMatchObject({
			title: next.title,
			status: next.status
		});
	});

	it('matches what next picks for the same subtask, apart from the dotted ID', () => {
		const sub = stored({ complexity: 5 });
		const parent = createTask({
			id: 3,
			title: 'Cycles',
			status: 'in-progress',
			priority: 'high',
			subtasks: [stored({ id: 1, status: 'done', dependencies: [] }), sub]
		});

		const next = selectNextTask([parent]) as unknown as Subtask;

		expect(next).toMatchObject({
			id: '3.2',
			parentId: '3',
			priority: 'high',
			complexity: 5,
			dependencies: ['3.1']
		});
		expect(subtaskInContext(parent, sub)).toMatchObject({
			parentId: next.parentId,
			priority: next.priority,
			complexity: next.complexity
		});
	});
});
