/**
 * remove-task, remove-subtask and clear-subtasks on tasks as stored: what
 * each removes, that a bad ID changes nothing, and that dependencies, their
 * provenance marks and related / discovered-from links go with what was
 * removed (but links to archived tasks stay).
 */

import { describe, expect, it } from 'vitest';
import type { Task } from '../../../common/types/index.js';
import {
	clearSubtasksIn,
	previewTaskRemoval,
	removeSubtasksIn,
	removeTasksIn
} from './task-removal.js';

type Raw = Record<string, any>;

const tasksOf = (): Raw[] => [
	{ id: 1, title: 'One', status: 'pending', dependencies: [] },
	{
		id: 2,
		title: 'Two',
		status: 'pending',
		priority: 'high',
		dependencies: [1],
		subtasks: [
			{ id: 1, title: 'Two.1', status: 'pending', dependencies: [] },
			{
				id: 2,
				title: 'Two.2',
				description: '',
				status: 'done',
				// sibling 2.1 (the number) and task 1 (the string)
				dependencies: [1, '1'],
				metadata: {
					owner: 'kim',
					dependencySources: { 2.1: 'inferred', 1: 'inferred' }
				}
			}
		]
	},
	{
		id: 3,
		title: 'Three',
		status: 'pending',
		dependencies: [1, '2.2'],
		metadata: {
			jira: 'A-3',
			dependencySources: { 1: 'inferred' },
			taskLinks: { 1: 'related', 2.2: 'discovered-from', 7: 'related' }
		}
	}
];

const none = new Set<string>();
const asTasks = (tasks: Raw[]) => tasks as unknown as Task[];

describe('removeTasksIn', () => {
	it('removes a task and every dependency, mark and link on it', () => {
		const tasks = tasksOf();

		const result = removeTasksIn(
			asTasks(tasks),
			['1'],
			'master',
			new Set(['7'])
		);

		expect(tasks.map((t) => t.id)).toEqual([2, 3]);
		expect(tasks[0].dependencies).toEqual([]);
		expect(tasks[0].subtasks[1].dependencies).toEqual([1]);
		expect(tasks[1].dependencies).toEqual(['2.2']);
		// The link to archived task 7 stays
		expect(tasks[1].metadata).toEqual({
			jira: 'A-3',
			taskLinks: { 2.2: 'discovered-from', 7: 'related' }
		});
		expect(result).toMatchObject({
			messages: ["Successfully removed task 1 from tag 'master'"],
			removedTaskNumbers: [1],
			danglingDependents: 0
		});
		expect(result.removedTasks[0]).toMatchObject({ id: 1, title: 'One' });
	});

	it("drops references to a removed task's subtasks", () => {
		const tasks = tasksOf();

		removeTasksIn(asTasks(tasks), ['2'], 'master', new Set(['7']));

		expect(tasks[1].dependencies).toEqual([1]);
		expect(tasks[1].metadata.taskLinks).toEqual({ 1: 'related', 7: 'related' });
	});

	it('removes a subtask, giving its parent as a number', () => {
		const tasks = tasksOf();

		const result = removeTasksIn(asTasks(tasks), ['2.2'], 'dev', none);

		expect(tasks[1].subtasks.map((s: Raw) => s.id)).toEqual([1]);
		expect(tasks[2].dependencies).toEqual([1]);
		expect(result.removedTasks[0]).toMatchObject({ id: 2, parentTaskId: 2 });
		expect(result.messages).toEqual([
			"Successfully removed subtask 2.2 from tag 'dev'"
		]);
		expect(result.removedTaskNumbers).toEqual([]);
	});

	it('changes nothing when any ID names nothing', () => {
		const tasks = tasksOf();

		expect(() =>
			removeTasksIn(asTasks(tasks), ['1', '99', '2.9'], 'master', none)
		).toThrow("The following tasks were not found in tag 'master': 99, 2.9");
		expect(tasks).toEqual(tasksOf());
	});

	it('refuses a malformed subtask ID rather than removing its task', () => {
		const tasks = tasksOf();

		expect(() =>
			removeTasksIn(asTasks(tasks), ['2.', '2.1.1'], 'master', none)
		).toThrow("The following tasks were not found in tag 'master': 2., 2.1.1");
		expect(tasks).toEqual(tasksOf());
	});

	it('refuses an ID with trailing text rather than reading its number', () => {
		const tasks = tasksOf();

		expect(() =>
			removeTasksIn(asTasks(tasks), ['1x', '2.1x'], 'master', none)
		).toThrow("The following tasks were not found in tag 'master': 1x, 2.1x");
		expect(tasks).toEqual(tasksOf());
	});

	it('skips an ID gone already: listed twice, or under a removed task', () => {
		const tasks = tasksOf();

		const result = removeTasksIn(asTasks(tasks), ['2', '2', '2.1'], 'm', none);

		expect(result.removedTasks).toHaveLength(1);
		expect(tasks.map((t) => t.id)).toEqual([1, 3]);
	});

	it('counts tasks left depending on a missing task', () => {
		const tasks = [...tasksOf(), { id: 4, dependencies: [42], title: 'x' }];

		const result = removeTasksIn(asTasks(tasks), ['1'], 'master', none);

		expect(result.danglingDependents).toBe(1);
	});
});

describe('previewTaskRemoval', () => {
	it('lists what exists, what does not, subtasks and dependents', () => {
		expect(
			previewTaskRemoval(asTasks(tasksOf()), ['1', '2.2', '9', '2'])
		).toEqual({
			found: [
				{ id: '1', title: 'One' },
				{ id: '2.2', title: 'Two.2', parent: { id: '2', title: 'Two' } },
				{ id: '2', title: 'Two' }
			],
			missing: ['9'],
			subtaskCount: 2,
			dependents: [{ id: '1', dependentIds: ['2', '3'] }]
		});
	});
});

describe('removeSubtasksIn', () => {
	const options = { highestArchivedId: 0, archivedIds: none };

	it('deletes a subtask and drops the key with the last one', () => {
		const tasks = tasksOf();

		const result = removeSubtasksIn(asTasks(tasks), ['2.1', '2.2'], options);

		expect(result).toEqual([null, null]);
		expect(tasks[1]).not.toHaveProperty('subtasks');
		expect(tasks[2].dependencies).toEqual([1]);
		expect(tasks[2].metadata.taskLinks).toEqual({ 1: 'related' });
	});

	it('converts a subtask to a task above the archived IDs, keeping its marks', () => {
		const tasks = tasksOf();

		const [converted] = removeSubtasksIn(asTasks(tasks), ['2.2'], {
			...options,
			convert: true,
			highestArchivedId: 8
		}) as Raw[];

		expect(converted).toEqual({
			id: 9,
			title: 'Two.2',
			description: 'Two.2',
			details: '',
			status: 'done',
			// Sibling 2.1 is now the full ID, task 1 as it was, then the old parent
			dependencies: ['2.1', '1', '2'],
			priority: 'high',
			metadata: {
				owner: 'kim',
				dependencySources: { 2.1: 'inferred', 1: 'inferred' }
			}
		});
		expect(tasks.at(-1)).toBe(converted);
		// What depended on the subtask now depends on the task
		expect(tasks[2].dependencies).toEqual([1, 9]);
	});

	// The service saves nothing when this throws
	it('throws when an ID is not a subtask that exists', () => {
		const remove = (id: string) =>
			removeSubtasksIn(asTasks(tasksOf()), ['2.1', id], options);

		expect(() => remove('2')).toThrow('Invalid subtask ID format: 2.');
		expect(() => remove('9.1')).toThrow(
			"Task 9 not found, so subtask 9.1 doesn't exist"
		);
		expect(() => remove('2.9')).toThrow('Subtask 2.9 not found');
	});

	it.each(['2.1x', '2.1.5', '2.1 oops', '2x.1'])(
		'refuses %s, changing nothing (#539)',
		(id) => {
			const tasks = tasksOf();

			expect(() => removeSubtasksIn(asTasks(tasks), [id], options)).toThrow(
				`Invalid subtask ID format: ${id}.`
			);
			expect(tasks).toEqual(tasksOf());
		}
	);
});

describe('clearSubtasksIn', () => {
	it('clears the given tasks and reports those with none', () => {
		const tasks = tasksOf();

		const result = clearSubtasksIn(asTasks(tasks), '2, 1, 2');

		expect(result).toEqual({
			cleared: [{ id: 2, title: 'Two', count: 2 }],
			empty: [{ id: 1, title: 'One' }]
		});
		expect(tasks[1].subtasks).toEqual([]);
		expect(tasks[2].dependencies).toEqual([1]);
	});

	it('clears every task with "all"', () => {
		const result = clearSubtasksIn(asTasks(tasksOf()), 'all');

		expect(result.cleared.map((t) => t.id)).toEqual([2]);
		expect(result.empty.map((t) => t.id)).toEqual([1, 3]);
	});

	it.each([
		['2.1', '2.1 is a subtask, not a task', /remove-subtask --id=2.1/],
		['x', '"x" isn\'t a task ID', /--id=3,5/],
		['9', 'Task 9 not found', undefined]
	])('refuses %s, changing nothing', (id, message, hint) => {
		const tasks = tasksOf();

		let error: any;
		try {
			clearSubtasksIn(asTasks(tasks), `2,${id}`);
		} catch (caught) {
			error = caught;
		}

		expect(error.message).toBe(message);
		if (hint) expect(error.hint).toMatch(hint);
		expect(tasks).toEqual(tasksOf());
	});
});
