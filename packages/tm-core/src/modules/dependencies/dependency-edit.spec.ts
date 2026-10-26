/**
 * add-dependency and remove-dependency on tasks as stored: what each writes,
 * how a subtask's types keep their meaning (#290), provenance marks, and
 * related / discovered-from links (#200).
 */

import { describe, expect, it } from 'vitest';
import type { Task } from '../../common/types/index.js';
import { addDependencyIn, removeDependencyIn } from './dependency-edit.js';

type Id = string | number;
type Raw = Record<string, any>;

const task = (id: Id, dependencies: Id[] = [], extra: Raw = {}): Raw => ({
	id,
	title: `Task ${id}`,
	status: 'pending',
	dependencies,
	...extra
});
const subtask = (id: Id, dependencies: Id[] = [], extra: Raw = {}): Raw => ({
	id,
	title: `Subtask ${id}`,
	status: 'pending',
	dependencies,
	...extra
});
const add = (
	tasks: Raw[],
	id: string,
	dependsOn: string,
	type?: string,
	archived: string[] = []
) =>
	addDependencyIn(
		tasks as unknown as Task[],
		id,
		dependsOn,
		new Set(archived),
		type
	);
const remove = (tasks: Raw[], id: string, dependsOn: string) =>
	removeDependencyIn(tasks as unknown as Task[], id, dependsOn);

describe('addDependencyIn', () => {
	it('stores a task list as strings, sorted, rewriting a mixed list (#290)', () => {
		const tasks = [
			task(1),
			task(2),
			task(3, [], { subtasks: [subtask(1)] }),
			task(4, [2, '1'])
		];

		const result = add(tasks, '4', '3.1');

		expect(result).toEqual({
			taskId: '4',
			dependencyId: '3.1',
			type: 'blocks',
			changed: true,
			message: 'Task 4 now depends on task 3.1'
		});
		expect(tasks[3].dependencies).toEqual(['1', '2', '3.1']);
		expect(tasks[3]).not.toHaveProperty('metadata');
	});

	it('keeps a task as "1" on a subtask, apart from sibling 1 (#290)', () => {
		const tasks = [
			task(1),
			task(2, [], { subtasks: [subtask(1), subtask(2, [1])] })
		];

		add(tasks, '2.2', '1');

		expect(tasks[1].subtasks[1].dependencies).toEqual([1, '1']);
	});

	it('adds sibling 2.1 to a subtask that lists the task "1"', () => {
		const tasks = [
			task(1),
			task(2, [], { subtasks: [subtask(1), subtask(2, ['1'])] })
		];

		add(tasks, '2.2', '2.1');

		expect(tasks[1].subtasks[1].dependencies).toEqual(['1', '2.1']);
	});

	it('works on string IDs, as tm-core saves them', () => {
		const tasks = [task('1'), task('2', [], { subtasks: [subtask(1)] })];

		add(tasks, '2', '1');
		add(tasks, '2.1', '1');

		expect(tasks[1].dependencies).toEqual(['1']);
		expect(tasks[1].subtasks[0].dependencies).toEqual(['1']);
	});

	it('makes an inferred dependency explicit, leaving other marks alone', () => {
		const tasks = [
			task(1),
			task(2),
			task(3, [1, 2], {
				metadata: {
					jira: 'ABC-1',
					dependencySources: { 1: 'inferred', 2: 'inferred' }
				}
			})
		];

		const result = add(tasks, '3', '1');

		expect(result).toMatchObject({
			changed: true,
			message: 'Task 3 now lists task 1 as an explicit dependency'
		});
		expect(tasks[2].dependencies).toEqual([1, 2]);
		expect(tasks[2].metadata).toEqual({
			jira: 'ABC-1',
			dependencySources: { 2: 'inferred' }
		});
	});

	it('changes nothing for an explicit dependency it already has', () => {
		const tasks = [task(1), task(3, [1])];

		expect(add(tasks, '3', '1')).toMatchObject({
			changed: false,
			message: 'Task 3 already depends on task 1; nothing changed'
		});
		expect(tasks[1]).not.toHaveProperty('metadata');
	});

	it('does not duplicate a sibling stored as a bare number', () => {
		const tasks = [
			task(2, [], {
				subtasks: [
					subtask(1),
					subtask(3, [1], {
						metadata: { dependencySources: { 2.1: 'inferred' } }
					})
				]
			})
		];

		add(tasks, '2.3', '2.1');

		expect(tasks[0].subtasks[1].dependencies).toEqual([1]);
		expect(tasks[0].subtasks[1]).not.toHaveProperty('metadata');
	});

	it.each([
		['an unknown dependency', '2', '99', 'Task 99 not found'],
		['an unknown task', '99', '1', 'Task 99 not found'],
		['an unknown subtask', '2.9', '1', 'Subtask 2.9 not found'],
		['a task without subtasks', '1.1', '2', 'Task 1 has no subtasks'],
		['itself', '2', '2', "Task 2 can't depend on itself"],
		[
			'a loop',
			'1',
			'2',
			'That would make a loop: task 2 already depends on task 1'
		]
	])('refuses %s and changes nothing', (_case, id, dependsOn, message) => {
		const tasks = [task(1), task(2, [1], { subtasks: [subtask(1)] })];
		const before = structuredClone(tasks);

		expect(() => add(tasks, id, dependsOn)).toThrow(message);
		expect(tasks).toEqual(before);
	});

	it('refuses a loop through a dependency the subtask inherits (#698)', () => {
		// 4 waits on 1.1, so task 1 depending on 4 makes 1.1 wait on 4
		const tasks = [
			task('1', [], { subtasks: [subtask(1)] }),
			task('4', ['1.1'])
		];
		const before = structuredClone(tasks);

		expect(() => add(tasks, '1', '4')).toThrow(/would make a loop/);
		expect(tasks).toEqual(before);
	});

	it('allows a task to depend on its own subtask', () => {
		const tasks = [task('1', [], { subtasks: [subtask(1)] })];

		add(tasks, '1', '1.1');

		expect(tasks[0].dependencies).toEqual(['1.1']);
	});

	it('finds a loop through a subtask that depends on a task by number', () => {
		const tasks = [task(150), task(2, [], { subtasks: [subtask(1, [150])] })];

		expect(() => add(tasks, '150', '2.1')).toThrow(/would make a loop/);
	});

	it('finds a loop through a sibling stored as a bare number', () => {
		// 2.2 depends on sibling 1 (2.1), so 2.1 can't depend on 2.2
		const tasks = [task(2, [], { subtasks: [subtask(1), subtask(2, [1])] })];

		expect(() => add(tasks, '2.1', '2.2')).toThrow(/would make a loop/);
	});

	it('allows a dependency when the loop is elsewhere in the graph', () => {
		const tasks = [task(1, [2]), task(2, [1]), task(3), task(4)];

		add(tasks, '3', '4');

		expect(tasks[2].dependencies).toEqual(['4']);
	});

	it('checks a loop along a chain too deep for recursion', () => {
		const tasks = Array.from({ length: 100000 }, (_, i) =>
			task(i + 1, i === 0 ? [] : [i])
		);

		expect(() => add(tasks, '1', '100000')).toThrow(/would make a loop/);
	});

	it('points at restore for an archived task', () => {
		expect(() => add([task(2)], '2', '1', undefined, ['1'])).toThrow(
			'Task 1 is archived, so it already counts as done'
		);
	});

	it('rejects an unknown link type, with a hint', () => {
		expect(() => add([task(1), task(2)], '2', '1', 'relates')).toThrow(
			expect.objectContaining({
				message: '"relates" isn\'t a link type',
				hint: 'Use --type=blocks, related or discovered-from'
			})
		);
	});
});

describe('addDependencyIn with a link type', () => {
	const linked = () => [
		task(1),
		task(2, [1], { metadata: { owner: 'kim' }, subtasks: [subtask(1)] }),
		task(3, [], { metadata: { taskLinks: { 1: 'related' } } }),
		task(4)
	];

	it('related stores a link and leaves dependencies alone', () => {
		const tasks = linked();

		expect(add(tasks, '4', '1', 'related')).toMatchObject({
			type: 'related',
			changed: true,
			message: 'Task 4 is now related to task 1'
		});
		expect(tasks[3].dependencies).toEqual([]);
		expect(tasks[3].metadata).toEqual({ taskLinks: { 1: 'related' } });
	});

	it('discovered-from on a subtask is keyed by the full ID', () => {
		const tasks = linked();

		add(tasks, '2.1', '3', 'discovered-from');

		expect(tasks[1].subtasks[0].metadata).toEqual({
			taskLinks: { 3: 'discovered-from' }
		});
	});

	it('turns an existing blocker into a related link', () => {
		const tasks = linked();

		expect(add(tasks, '2', '1', 'related').message).toBe(
			'Task 2 is now related to task 1 and no longer waits for it'
		);
		expect(tasks[1].dependencies).toEqual([]);
		expect(tasks[1].metadata).toEqual({
			owner: 'kim',
			taskLinks: { 1: 'related' }
		});
	});

	it('a plain add turns a related link back into a blocker', () => {
		const tasks = linked();

		add(tasks, '3', '1');

		expect(tasks[2].dependencies).toEqual(['1']);
		expect(tasks[2]).not.toHaveProperty('metadata');
	});

	it('links never count as a loop', () => {
		const tasks = linked();

		add(tasks, '1', '3');

		expect(tasks[0].dependencies).toEqual(['3']);
	});

	it('the same link twice changes nothing; a link to itself is refused', () => {
		const tasks = linked();

		expect(add(tasks, '3', '1', 'related').changed).toBe(false);
		expect(() => add(tasks, '4', '4', 'related')).toThrow(
			"Task 4 can't link to itself"
		);
	});
});

describe('removeDependencyIn', () => {
	it('drops the dependency and its inferred mark, keeping user metadata', () => {
		const tasks = [
			task(1),
			task(3, [1], {
				metadata: { jira: 'ABC-1', dependencySources: { 1: 'inferred' } }
			})
		];

		expect(remove(tasks, '3', '1')).toEqual({
			taskId: '3',
			dependencyId: '1',
			removed: true,
			message: 'Task 3 no longer depends on task 1'
		});
		expect(tasks[1].dependencies).toEqual([]);
		expect(tasks[1].metadata).toEqual({ jira: 'ABC-1' });
	});

	it('takes out the task, not the sibling with the same number', () => {
		const tasks = [
			task(1),
			task(2, [], { subtasks: [subtask(1), subtask(2, [1, '1'])] })
		];

		remove(tasks, '2.2', '1');

		expect(tasks[1].subtasks[1].dependencies).toEqual([1]);
	});

	it('takes out a sibling stored as a bare number', () => {
		const tasks = [
			task(2, [], { subtasks: [subtask(1), subtask(2, ['1', 1])] })
		];

		remove(tasks, '2.2', '2.1');

		expect(tasks[0].subtasks[1].dependencies).toEqual(['1']);
	});

	it('removes a related link', () => {
		const tasks = [
			task(1),
			task(3, [], {
				metadata: { taskLinks: { 1: 'related', 2.2: 'discovered-from' } }
			})
		];

		expect(remove(tasks, '3', '1').message).toBe(
			'Task 3 is no longer linked to task 1'
		);
		expect(tasks[1].metadata).toEqual({
			taskLinks: { 2.2: 'discovered-from' }
		});
	});

	it('changes nothing for a dependency the task never had (#291)', () => {
		expect(remove([task(1), task(2, [1])], '2', '5')).toMatchObject({
			removed: false,
			message: "Task 2 doesn't depend on task 5; nothing changed"
		});
		expect(remove([task(1)], '1', '5')).toMatchObject({
			removed: false,
			message: 'Task 1 has no dependencies; nothing changed'
		});
	});

	it('refuses an unknown task', () => {
		expect(() => remove([task(1)], '99', '1')).toThrow('Task 99 not found');
	});
});
