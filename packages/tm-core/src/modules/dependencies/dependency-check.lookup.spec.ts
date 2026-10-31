/**
 * createTaskLookup: which IDs name a task or subtask, as validate-dependencies
 * and add-dependency check them, and what fixTaskDependencies does with an ID
 * stored as typed.
 */

import { describe, expect, it } from 'vitest';
import type { Task } from '../../common/types/index.js';
import {
	createTaskLookup,
	fixTaskDependencies,
	validateTaskDependencies
} from './dependency-check.js';

const asTasks = (tasks: Record<string, any>[]) => tasks as unknown as Task[];

describe('createTaskLookup', () => {
	it('finds tasks and subtasks by number or stored string ID, the first task winning', () => {
		const exists = createTaskLookup(
			asTasks([
				{ id: 1, subtasks: [{ id: 1 }, { id: 2 }] },
				{ id: 1, subtasks: [{ id: 9 }] },
				{ id: '4', subtasks: [{ id: '1' }] },
				{ id: 3, subtasks: [] }
			])
		);

		for (const id of [1, '1', '1.1', '1.2', '4', '4.1']) {
			expect(exists(id), `id ${id}`).toBe(true);
		}
		// #864: "1.01" and "1.1x" passed here but not the loop check, hiding loops
		for (const id of [
			...[0, '', '2', '1.9', '3.1', '3.y', 'x.1', 'x', '.1'],
			...['01', '1.01', '01.1', '1.1x', '1.2.3', ' 1']
		]) {
			expect(exists(id), `id ${id}`).toBe(false);
		}
	});
});

describe('fixTaskDependencies with IDs older versions stored as typed (#864)', () => {
	it('rewrites them in their stored form rather than removing them', () => {
		const tasks = asTasks([
			{ id: '1', dependencies: [], subtasks: [{ id: '1', dependencies: [] }] },
			{
				id: '2',
				dependencies: ['01', '1.01', '1', '09', '1x'],
				subtasks: [{ id: '1', dependencies: ['01.01', 1] }]
			}
		]);

		const { fixes } = fixTaskDependencies(tasks);

		expect(tasks[1].dependencies).toEqual(['1', '1.1']);
		expect(tasks[1].subtasks[0].dependencies).toEqual(['1.1']);
		expect(fixes).toEqual([
			{ type: 'rewritten', taskId: '2', dependencyId: '1', storedAs: '01' },
			{ type: 'rewritten', taskId: '2', dependencyId: '1.1', storedAs: '1.01' },
			{
				type: 'rewritten',
				taskId: '2.1',
				dependencyId: '1.1',
				storedAs: '01.01'
			},
			{ type: 'duplicate', taskId: '2', dependencyId: '1' },
			{ type: 'missing', taskId: '2', dependencyId: '09' },
			{ type: 'missing', taskId: '2', dependencyId: '1x' },
			{ type: 'self', taskId: '2.1' }
		]);
		expect(validateTaskDependencies(tasks).issues).toEqual([]);
	});

	it('keeps a subtask dependency an older file stored as a number', () => {
		const tasks = asTasks([
			{ id: '1', dependencies: [], subtasks: [{ id: '2', dependencies: [] }] },
			{ id: '2', dependencies: [1.2, 1.3], subtasks: [] }
		]);

		const { fixes } = fixTaskDependencies(tasks);

		expect(tasks[1].dependencies).toEqual([1.2]);
		expect(fixes).toEqual([
			{ type: 'missing', taskId: '2', dependencyId: 1.3 }
		]);
	});
});
