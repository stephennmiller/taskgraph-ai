import { describe, expect, it } from 'vitest';
import type { Task } from '../../../common/types/index.js';
import { createSubtask, createTask } from '../../../testing/task-fixtures.js';
import { TaskGraphError } from '../../../common/errors/taskgraph-error.js';
import {
	DEFAULT_TASK_FIELDS,
	TASK_FIELDS,
	type TaskField,
	parseTaskFields,
	selectTaskFields
} from './task-fields.js';

describe('parseTaskFields', () => {
	it.each([[undefined], [''], [' , ']])(
		'gives the default fields for %j',
		(input) => {
			expect(parseTaskFields(input)).toEqual([...DEFAULT_TASK_FIELDS]);
		}
	);

	it('keeps id first and drops repeats', () => {
		expect(parseTaskFields(' title, details,title ')).toEqual([
			'id',
			'title',
			'details'
		]);
	});

	it('adds subtasks with withSubtasks', () => {
		expect(parseTaskFields('title', { withSubtasks: true })).toEqual([
			'id',
			'title',
			'subtasks'
		]);
		expect(parseTaskFields(undefined, { withSubtasks: true })).toEqual([
			...DEFAULT_TASK_FIELDS,
			'subtasks'
		]);
	});

	it('drops subtasks with withSubtasks false', () => {
		expect(parseTaskFields('title,subtasks', { withSubtasks: false })).toEqual(
			['id', 'title']
		);
	});

	it('reads all as every field', () => {
		expect(parseTaskFields('title,all')).toBe('all');
	});

	it('still rejects an unknown field next to all', () => {
		expect(() => parseTaskFields('all,titel')).toThrow(
			/^Unknown task field: titel\./
		);
	});

	it('accepts every Task field', () => {
		// Fails to compile when Task gains a field TASK_FIELDS doesn't list
		const listsAll: [Exclude<keyof Task, TaskField>] extends [never]
			? true
			: false = true;
		expect(listsAll).toBe(true);
		expect(parseTaskFields('skills,category,relevantFiles')).toEqual([
			'id',
			'skills',
			'category',
			'relevantFiles'
		]);
		expect(TASK_FIELDS).toContain('implementationApproach');
	});

	it('names the unknown fields and the valid ones', () => {
		expect(() => parseTaskFields('title,detials,owner')).toThrow(
			TaskGraphError
		);
		expect(() => parseTaskFields('detials')).toThrow(
			/^Unknown task field: detials\. Valid fields: all, id, title,/
		);
	});
});

describe('selectTaskFields', () => {
	const task = createTask({
		id: 1,
		title: 'Login',
		details: 'Long implementation notes',
		testStrategy: 'Unit tests',
		dependencies: ['2'],
		subtasks: [
			createSubtask({ id: 1, parentId: '1', title: 'Form', details: 'More' })
		]
	});

	it('keeps only the given fields', () => {
		expect(selectTaskFields([task], parseTaskFields())).toEqual([
			{
				id: '1',
				title: 'Login',
				status: 'pending',
				priority: 'medium',
				dependencies: ['2']
			}
		]);
	});

	it('gives subtasks the same fields', () => {
		const [picked] = selectTaskFields([task], ['id', 'title', 'subtasks']);
		expect(picked).toEqual({
			id: '1',
			title: 'Login',
			subtasks: [{ id: 1, title: 'Form' }]
		});
	});

	it('leaves out a field the task does not have', () => {
		const [picked] = selectTaskFields([task], ['id', 'assignee']);
		expect(picked).toEqual({ id: '1' });
	});

	it('returns the tasks whole for all', () => {
		expect(selectTaskFields([task], 'all')).toEqual([task]);
	});
});
