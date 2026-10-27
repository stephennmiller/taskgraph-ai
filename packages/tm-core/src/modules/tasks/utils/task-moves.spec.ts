import { describe, expect, it } from 'vitest';
import type { Task } from '../../../common/types/index.js';
import { moveTasksBetweenTags } from './move-between-tags.js';
import { moveTasksIn } from './move-within-tag.js';
import { MOVE_ERROR_CODES, addSubtaskIn } from './task-moves.js';

// Tasks as older files store them: numeric IDs and dependencies
const sample = (): Task[] =>
	[
		{ id: 1, title: 'Set up', status: 'done', dependencies: [], subtasks: [] },
		{
			id: 2,
			title: 'Parser',
			status: 'pending',
			dependencies: [1],
			subtasks: [
				{ id: 1, title: 'Read', status: 'pending', dependencies: [] },
				{ id: 2, title: 'Validate', status: 'pending', dependencies: [1] }
			]
		},
		{
			id: 3,
			title: 'Plugins',
			status: 'pending',
			dependencies: [],
			subtasks: []
		},
		{
			id: 4,
			title: 'Report',
			status: 'pending',
			dependencies: [2, 3],
			subtasks: []
		},
		{
			id: 5,
			title: 'Publish',
			status: 'pending',
			dependencies: [4],
			subtasks: []
		}
	] as unknown as Task[];

const ids = (tasks: Task[]) => tasks.map((t) => String(t.id));
const noArchive = new Set<string>();

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

	it('refuses a task its new parent depends on', () => {
		const tasks = sample();

		expect(() => addSubtaskIn(tasks, '5', { fromTaskId: '3' })).toThrow(
			'Cannot create circular dependency: task 5 is already a subtask or dependent of task 3'
		);
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

	it('fails a batch on a taken ID, and skips pairs that name the same ID', () => {
		expect(() =>
			moveTasksIn(sample(), '3,4', '8,1', 'master', noArchive)
		).toThrow('Task with ID 1 already exists');

		const result = moveTasksIn(sample(), '3,4', '8,4', 'master', noArchive);
		expect(result.moves).toHaveLength(1);
		expect(result.skipped).toEqual([{ fromId: '4', toId: '4' }]);
	});
});

describe('moveTasksBetweenTags', () => {
	const tagsWith = () =>
		new Map<string, Task[]>([
			['master', sample()],
			[
				'feature',
				[{ id: 1, title: 'Layout', dependencies: [], subtasks: [] }] as any
			]
		]);
	const archived = () => noArchive;

	it('refuses a move that leaves a dependency behind, with the conflicts', () => {
		const tags = tagsWith();

		let error: any;
		try {
			moveTasksBetweenTags(tags, ['4'], 'master', 'feature', {}, archived);
		} catch (e) {
			error = e;
		}

		expect(error.message).toBe(
			'Cannot move tasks: 3 cross-tag dependency conflicts found'
		);
		expect(error.context.details.moveCode).toBe(
			MOVE_ERROR_CODES.CROSS_TAG_DEPENDENCY_CONFLICTS
		);
		expect(error.context.details.conflicts[0].message).toBe(
			'Task 4 depends on 2 (in master)'
		);
	});

	it('drops those dependencies with ignoreDependencies and says what to run', () => {
		const tags = tagsWith();

		const result = moveTasksBetweenTags(
			tags,
			['4'],
			'master',
			'feature',
			{ ignoreDependencies: true },
			archived
		);

		const moved = tags.get('feature')?.find((t) => String(t.id) === '4');
		expect(moved?.dependencies).toEqual([]);
		expect(result.movedTasks).toEqual([
			{ id: '4', fromTag: 'master', toTag: 'feature' }
		]);
		expect(result.tips).toHaveLength(2);
		expect(ids(tags.get('master') ?? [])).toEqual(['1', '2', '3', '5']);
		// Task 5 no longer depends on 4, now in another tag
		expect(tags.get('master')?.[3].dependencies).toEqual([]);
	});

	it('brings what the tasks depend on along with withDependencies', () => {
		const tags = tagsWith();
		tags.set('feature', []);

		const result = moveTasksBetweenTags(
			tags,
			['5'],
			'master',
			'feature',
			{ withDependencies: true },
			archived
		);

		expect(result.movedTasks.map((m) => m.id)).toEqual(['5', 4, 2, 1, 3]);
		expect(ids(tags.get('master') ?? [])).toEqual([]);
	});

	it('still refuses dependents left behind with withDependencies (#674)', () => {
		const tags = tagsWith();
		tags.set('feature', []);

		expect(() =>
			moveTasksBetweenTags(
				tags,
				['4'],
				'master',
				'feature',
				{ withDependencies: true },
				archived
			)
		).toThrow('Cannot move tasks: 1 cross-tag dependency conflicts found');
		expect(ids(tags.get('master') ?? [])).toEqual(['1', '2', '3', '4', '5']);
	});

	it('moves tasks that depend on each other once each', () => {
		const tags = new Map<string, Task[]>([
			[
				'master',
				[
					{ id: 1, title: 'A', dependencies: [2], subtasks: [] },
					{ id: 2, title: 'B', dependencies: ['1'], subtasks: [] }
				] as any
			]
		]);

		const result = moveTasksBetweenTags(
			tags,
			['1'],
			'master',
			'feature',
			{ withDependencies: true },
			archived
		);

		expect(result.movedTasks.map((m) => String(m.id))).toEqual(['1', '2']);
		expect(ids(tags.get('master') ?? [])).toEqual([]);
	});

	// Task 3 with subtask 3.1 (which needs task 1); 4 needs 3, 5 needs 3.1, 6.1 needs 3
	const withDependents = () =>
		new Map<string, Task[]>([
			[
				'master',
				[
					{ id: '1', title: 'Set up', dependencies: [], subtasks: [] },
					{
						id: '3',
						title: 'Plugins',
						dependencies: [],
						subtasks: [{ id: 1, title: 'Load', dependencies: ['1', 2] }]
					},
					{ id: '4', title: 'Report', dependencies: ['3'], subtasks: [] },
					{ id: '5', title: 'Docs', dependencies: ['3.1'], subtasks: [] },
					{
						id: '6',
						title: 'Ship',
						dependencies: [],
						subtasks: [{ id: 1, title: 'Tag', dependencies: ['3', 1] }]
					}
				] as any
			]
		]);

	it('refuses a move that leaves tasks depending on the moved task or its subtasks (#674)', () => {
		let error: any;
		try {
			moveTasksBetweenTags(
				withDependents(),
				['3'],
				'master',
				'feature',
				{},
				archived
			);
		} catch (e) {
			error = e;
		}

		expect(error?.context.details.conflicts.map((c: any) => c.message)).toEqual(
			[
				'Task 3.1 depends on 1 (in master)',
				'Task 4 depends on 3, which moves to feature',
				'Task 5 depends on 3.1, which moves to feature',
				'Task 6.1 depends on 3, which moves to feature'
			]
		);
	});

	it('drops the dependencies on the moved task with ignoreDependencies (#674)', () => {
		const tags = withDependents();

		const result = moveTasksBetweenTags(
			tags,
			['3'],
			'master',
			'feature',
			{ ignoreDependencies: true },
			archived
		);

		const master = tags.get('master') as any[];
		expect(master.map((t) => t.dependencies)).toEqual([[], [], [], []]);
		expect(master[3].subtasks[0].dependencies).toEqual([1]);
		expect(tags.get('feature')?.[0].subtasks?.[0].dependencies).toEqual([2]);
		expect(result.tips).toHaveLength(2);
	});

	it('creates a missing target tag, but not a reserved one', () => {
		const tags = tagsWith();

		moveTasksBetweenTags(
			tags,
			['1'],
			'master',
			'sprint',
			{ ignoreDependencies: true },
			archived
		);
		expect(ids(tags.get('sprint') ?? [])).toEqual(['1']);

		expect(() =>
			moveTasksBetweenTags(tags, ['3'], 'master', 'tag', {}, archived)
		).toThrow('"tag" is a reserved tag name');
		expect(() =>
			moveTasksBetweenTags(tags, ['3'], 'master', 'x/../y', {}, archived)
		).toThrow('"x/../y" isn\'t a valid tag name');
		expect(tags.has('x/../y')).toBe(false);
	});

	it('refuses a subtask and an ID the target tag has', () => {
		expect(() =>
			moveTasksBetweenTags(
				tagsWith(),
				['2.1'],
				'master',
				'feature',
				{},
				archived
			)
		).toThrow('Cannot move subtask 2.1 directly between tags');
		expect(() =>
			moveTasksBetweenTags(
				tagsWith(),
				['1'],
				'master',
				'feature',
				{ ignoreDependencies: true },
				archived
			)
		).toThrow('Task 1 already exists in target tag "feature"');
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
