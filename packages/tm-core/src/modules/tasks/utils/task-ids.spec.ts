import { describe, expect, it } from 'vitest';
import type { Task } from '../../../common/types/index.js';
import { normalizeTaskIds, withFullSubtaskIds } from './task-ids.js';

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

// #661: list and show --json gave a subtask "id": "1", which set-status reads as task 1
describe('withFullSubtaskIds', () => {
	it('gives each subtask its full dotted ID and full-ID dependencies, and keeps parentId (#700)', () => {
		const task = withFullSubtaskIds(normalizeTaskIds(stored()));

		expect(task.subtasks.map((st) => [st.id, st.parentId])).toEqual([
			['2.1', '2'],
			['2.2', '2']
		]);
		expect(task.subtasks[1].dependencies).toEqual(['2.1', '3', '2.1']);
	});

	it('keeps an ID that is already dotted', () => {
		const task = withFullSubtaskIds({
			...stored(),
			subtasks: [{ ...stored().subtasks[0], id: '2.1' }]
		} as unknown as Task);

		expect(task.subtasks[0].id).toBe('2.1');
	});

	it('leaves a subtask view, which has no subtasks list, and null as they are', () => {
		const view = { id: '2.1', parentId: '2', title: 'Schema' };

		expect(withFullSubtaskIds(view)).toBe(view);
		expect(withFullSubtaskIds(null)).toBeNull();
	});
});
