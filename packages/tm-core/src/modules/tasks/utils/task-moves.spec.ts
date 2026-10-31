import { describe, expect, it } from 'vitest';
import type { Task } from '../../../common/types/index.js';
import { moveTasksBetweenTags } from './move-between-tags.js';
import { moveTasksIn } from './move-within-tag.js';
import { addSubtaskIn } from './task-moves.js';
import { ids, noArchive, sample } from './task-moves.fixture.js';

describe('addSubtaskIn', () => {
	it('adds a new subtask with the next ID and its parsed dependencies', () => {
		const tasks = sample();

		const subtask = addSubtaskIn(tasks, '2', {
			subtask: { title: 'Report errors', dependencies: ['1', '2.1'] }
		});

		expect(subtask).toEqual({
			id: '3',
			title: 'Report errors',
			description: '',
			details: '',
			status: 'pending',
			dependencies: ['1', '2.1']
		});
		expect(tasks[1].subtasks).toHaveLength(3);
	});

	it("numbers past the task's own subtasks, not a dotted ID with another task's prefix (#805)", () => {
		const tasks = sample();
		tasks[1].subtasks.push({ id: '4.1', title: 'Odd' } as never);

		const subtask = addSubtaskIn(tasks, '2', { subtask: { title: 'Next' } });

		expect(subtask.id).toBe('3');
	});

	it('refuses a status set-status would refuse, and adds nothing', () => {
		const tasks = sample();

		expect(() =>
			addSubtaskIn(tasks, '2', { subtask: { title: 'Sub', status: 'bogus' } })
		).toThrow('"bogus" isn\'t a status');
		expect(tasks[1].subtasks).toHaveLength(2);
	});

	it('turns a task into a subtask and repoints what depended on it', () => {
		const tasks = sample();

		const subtask = addSubtaskIn(tasks, '2', { fromTaskId: '3' });

		expect(subtask).toMatchObject({ id: '3', title: 'Plugins' });
		expect(ids(tasks)).toEqual(['1', '2', '4', '5']);
		expect(tasks.find((t) => String(t.id) === '4')?.dependencies).toEqual([
			2,
			'2.3'
		]);
	});

	it('refuses a task that its new parent reaches through another task', () => {
		// 5 waits on 4, which waits on 3; as 5.1, 3 would also wait on 4
		const tasks = sample();
		const before = structuredClone(tasks);

		expect(() => addSubtaskIn(tasks, '5', { fromTaskId: '3' })).toThrow(
			'Cannot make task 3 a subtask of task 5: that would make a dependency loop'
		);
		expect(tasks).toEqual(before);
	});

	it('refuses a task that waits on its new parent (#803)', () => {
		// 5 waits on 4, which waits on 2; task 2 can't finish before 2.3 (5)
		const tasks = sample();

		expect(() => addSubtaskIn(tasks, '2', { fromTaskId: '5' })).toThrow(
			'Cannot make task 5 a subtask of task 2: that would make a dependency loop'
		);
	});

	it('refuses a task that also lists its new parent, which the move drops (#803)', () => {
		// 5 needs 2 and 4; as 2.3 it drops 2 but still needs 4, which needs 2
		const tasks = sample();
		(tasks[4] as unknown as { dependencies: number[] }).dependencies = [2, 4];
		const before = structuredClone(tasks);

		expect(() => addSubtaskIn(tasks, '2', { fromTaskId: '5' })).toThrow(
			'Cannot make task 5 a subtask of task 2: that would make a dependency loop'
		);
		expect(tasks).toEqual(before);
	});

	it('takes a task its new parent depends on directly (#803)', () => {
		const tasks = sample();

		addSubtaskIn(tasks, '5', { fromTaskId: '4' });

		// 5 now waits on its own subtask, which is no loop
		expect(tasks.find((t) => String(t.id) === '5')?.dependencies).toEqual([
			'5.1'
		]);
	});

	it('refuses a new subtask that depends on what waits on its parent (#803)', () => {
		const tasks = sample();

		expect(() =>
			addSubtaskIn(tasks, '2', {
				subtask: { title: 'Loop', dependencies: ['4'] }
			})
		).toThrow(
			'Cannot add a subtask to task 2 that depends on 4: that would make a dependency loop'
		);
		expect(tasks[1].subtasks).toHaveLength(2);
	});

	it('takes a subtask that lists its own parent, which is no loop', () => {
		const tasks = sample();

		addSubtaskIn(tasks, '2', {
			subtask: { title: 'After', dependencies: ['2'] }
		});
		addSubtaskIn(tasks, '4', { fromTaskId: '5' });

		expect(tasks[1].subtasks).toHaveLength(3);
		expect(ids(tasks)).toEqual(['1', '2', '3', '4']);
	});

	it('refuses a missing parent', () => {
		expect(() =>
			addSubtaskIn(sample(), '9', { subtask: { title: 'x' } })
		).toThrow('Parent task with ID 9 not found');
	});
});

describe('moveTasksIn', () => {
	it('moves a task to a free ID, at the end, and its dependents follow', () => {
		const tasks = sample();

		const { moves } = moveTasksIn(tasks, '3', '7', 'master', noArchive);

		expect(moves[0].message).toBe('Moved task 3 to new ID 7');
		expect(ids(tasks)).toEqual(['1', '2', '4', '5', '7']);
		expect(tasks.find((t) => String(t.id) === '4')?.dependencies).toEqual([
			2, 7
		]);
	});

	it('turns a subtask into a task, and a task into a subtask', () => {
		const tasks = sample();

		moveTasksIn(tasks, '2.2', '6', 'master', noArchive);
		moveTasksIn(tasks, '3', '2.5', 'master', noArchive);

		const six = tasks.find((t) => String(t.id) === '6');
		// Its sibling dependency becomes a full ID, which reads the same on a task
		expect(six?.dependencies).toEqual(['2.1']);
		expect(tasks[1].subtasks.map((st) => st.id)).toEqual([1, '5']);
		expect(tasks.find((t) => String(t.id) === '4')?.dependencies).toEqual([
			2,
			'2.5'
		]);
	});

	it('refuses a task whose dependencies reach its new parent, changing nothing (#824)', () => {
		// 5 waits on 4, which waits on 3; task 3 can't finish before 3.2 (5)
		const tasks = sample();
		const before = structuredClone(tasks);

		expect(() => moveTasksIn(tasks, '5', '3.2', 'master', noArchive)).toThrow(
			'Cannot move task 5 to 3.2: that would make a dependency loop'
		);
		expect(tasks).toEqual(before);
	});

	it('refuses a subtask whose sibling dependency reaches its new parent (#824)', () => {
		// 2.2 waits on 2.1, which waits on 1 through its parent
		const tasks = sample();
		const before = structuredClone(tasks);

		expect(() => moveTasksIn(tasks, '2.2', '1.1', 'master', noArchive)).toThrow(
			'Cannot move subtask 2.2 to 1.1: that would make a dependency loop'
		);
		expect(tasks).toEqual(before);
	});

	it('refuses a subtask that what its new parent waits on depends on (#824)', () => {
		// 5 waits on 4, 4 on 2, 2 on 2.2, and 2.2 on 2.1, which would be 5.1
		const tasks = sample();

		expect(() => moveTasksIn(tasks, '2.1', '5.1', 'master', noArchive)).toThrow(
			'Cannot move subtask 2.1 to 5.1: that would make a dependency loop'
		);
	});

	it('moves a subtask away from a parent its new parent waits on (#824)', () => {
		// 5 waits on 4 and 4 on 2, but 2 stops waiting on the subtask
		const tasks = sample();

		moveTasksIn(tasks, '2.2', '5.1', 'master', noArchive);

		expect(tasks[4].subtasks.map((st) => st.dependencies)).toEqual([['2.1']]);
	});

	it('refuses a subtask its old parent lists, when the new parent waits on that parent (#824)', () => {
		// 2 keeps waiting on 2.2 as 4.1, and 4.1 waits on 2 through task 4
		const tasks = sample();
		tasks[1].dependencies.push('2.2');

		expect(() => moveTasksIn(tasks, '2.2', '4.1', 'master', noArchive)).toThrow(
			'Cannot move subtask 2.2 to 4.1: that would make a dependency loop'
		);
	});

	it('moves a subtask that lists its old parent under a task that waits on it (#824)', () => {
		// 5 waits on 4 and 4 on 2, but 2 never waited on 2.2, which lists it
		const tasks = sample();
		tasks[1].subtasks[1].dependencies.push('2');

		moveTasksIn(tasks, '2.2', '5.1', 'master', noArchive);

		expect(tasks[4].subtasks.map((st) => st.dependencies)).toEqual([
			['2.1', '2']
		]);
	});

	it('refuses an archived destination ID', () => {
		expect(() =>
			moveTasksIn(sample(), '3', '9', 'master', new Set(['9']))
		).toThrow('Task 9 is archived in tag "master", so its ID is taken');
	});

	it('refuses ID lists of different lengths', () => {
		expect(() =>
			moveTasksIn(sample(), '3,4', '8', 'master', noArchive)
		).toThrow(
			'Number of source IDs (2) must match number of destination IDs (1)'
		);
	});

	it('refuses an ID that is not a number, instead of storing task "NaN"', () => {
		const tasks = sample();

		expect(() => moveTasksIn(tasks, '5', 'abc', 'master', noArchive)).toThrow(
			'Invalid task ID "abc"'
		);
		expect(ids(tasks)).toEqual(['1', '2', '3', '4', '5']);
	});

	it('reads leading zeros as everywhere else (#864)', () => {
		const tasks = sample();

		const { moves } = moveTasksIn(tasks, '02.02', '06', 'master', noArchive);

		expect(moves[0].message).toBe('Converted subtask 2.2 to task 6');
		expect(ids(tasks)).toContain('6');
		expect(
			moveTasksIn(sample(), '03,4', '3,9', 'master', noArchive).skipped
		).toEqual([{ fromId: '3', toId: '3' }]);
	});

	it('fails a batch on a taken ID, and skips pairs that name the same ID', () => {
		expect(() =>
			moveTasksIn(sample(), '3,4', '8,1', 'master', noArchive)
		).toThrow('Task with ID 1 already exists');

		const result = moveTasksIn(sample(), '3,4', '8,4', 'master', noArchive);
		expect(result.moves).toHaveLength(1);
		expect(result.skipped).toEqual([{ fromId: '4', toId: '4' }]);
	});
});

describe('related and discovered-from links on a move', () => {
	const links = (value: Record<string, string>) => ({ taskLinks: value });
	const linked = () =>
		[
			{ id: 1, title: 'One', dependencies: [] },
			{
				id: 2,
				title: 'Two',
				dependencies: [1],
				subtasks: [
					{ id: 1, title: 'Two.1', dependencies: [] },
					{
						id: 2,
						title: 'Two.2',
						dependencies: [],
						metadata: links({ '2.1': 'related' })
					}
				]
			},
			{
				id: 3,
				title: 'Three',
				dependencies: [],
				metadata: links({ '1': 'related', '2.2': 'discovered-from' })
			},
			{ id: 4, title: 'Four', dependencies: [] }
		] as unknown as Task[];
	const find = (tasks: Task[], id: number) =>
		tasks.find((t) => String(t.id) === String(id)) as any;

	it('follow a task moved to a new ID, with its subtasks', () => {
		const tasks = linked();

		moveTasksIn(tasks, '2', '7', 'master', noArchive);

		expect(find(tasks, 3).metadata).toEqual(
			links({ '1': 'related', '7.2': 'discovered-from' })
		);
		expect(find(tasks, 7).subtasks[1].metadata).toEqual(
			links({ '7.1': 'related' })
		);
	});

	it('follow a subtask that becomes a task', () => {
		const tasks = linked();

		moveTasksIn(tasks, '2.2', '9', 'master', noArchive);

		expect(find(tasks, 3).metadata).toEqual(
			links({ '1': 'related', '9': 'discovered-from' })
		);
		expect(find(tasks, 9).metadata).toEqual(links({ '2.1': 'related' }));
	});

	it("don't cross tags", () => {
		const master = linked();
		find(master, 4).metadata = links({ '3': 'related' });
		const tags = new Map<string, Task[]>([
			['master', master],
			['other', [{ id: 1, title: 'Other one', dependencies: [] }] as any]
		]);

		moveTasksBetweenTags(tags, ['3'], 'master', 'other', {}, () => noArchive);

		expect(find(tags.get('other') ?? [], 3).metadata.taskLinks).toBeUndefined();
		expect(find(master, 4).metadata).toBeUndefined();
	});
});
