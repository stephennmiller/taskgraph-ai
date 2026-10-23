import { describe, expect, it } from 'vitest';
import type { Task } from '../../../common/types/index.js';
import { normalizeTaskIds } from './task-ids.js';

/** A task as tasks.json stores it: numeric IDs, no subtask parentId */
const stored = (): Task =>
	({
		id: 2,
		title: 'Add Postgres',
		description: 'Add Postgres',
		status: 'pending',
		priority: 'medium',
		dependencies: [1],
		details: '',
		testStrategy: '',
		acceptanceCriteria: [{ text: 'Migrations run', checked: false }],
		subtasks: [
			{
				id: 1,
				title: 'Schema',
				description: 'Write the schema',
				status: 'pending',
				dependencies: []
			},
			{
				id: 2,
				title: 'Migrations',
				description: 'Add migrations',
				status: 'pending',
				dependencies: [1, '3', '2.1']
			}
		]
	}) as unknown as Task;

describe('normalizeTaskIds', () => {
	it('gives the task id and dependencies as strings', () => {
		const task = normalizeTaskIds(stored());

		expect(task.id).toBe('2');
		expect(task.dependencies).toEqual(['1']);
	});

	it("gives each subtask a string id and its task's id as parentId", () => {
		const task = normalizeTaskIds(stored());

		expect(task.subtasks.map((st) => [st.id, st.parentId])).toEqual([
			['1', '2'],
			['2', '2']
		]);
	});

	it('keeps a parentId the subtask already has', () => {
		const task = normalizeTaskIds({
			...stored(),
			subtasks: [{ ...stored().subtasks[0], parentId: '7' }]
		});

		expect(task.subtasks[0].parentId).toBe('7');
	});

	it('keeps the stored type of subtask dependencies, which carries their meaning', () => {
		const task = normalizeTaskIds(stored());

		expect(task.subtasks[1].dependencies).toEqual([1, '3', '2.1']);
	});

	it('keeps every other field', () => {
		const task = normalizeTaskIds(stored());

		expect(task.acceptanceCriteria).toEqual([
			{ text: 'Migrations run', checked: false }
		]);
		expect(task.title).toBe('Add Postgres');
	});

	it('fills in missing dependencies and subtasks', () => {
		const task = normalizeTaskIds({
			...stored(),
			dependencies: undefined,
			subtasks: undefined
		} as unknown as Task);

		expect(task.dependencies).toEqual([]);
		expect(task.subtasks).toEqual([]);
	});
});
