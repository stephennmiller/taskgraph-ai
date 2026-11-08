import { describe, expect, it } from 'vitest';
import type { Task } from '../../../common/types/index.js';
import { createSubtask, createTask } from '../../../testing/task-fixtures.js';
import {
	buildBlocksMap,
	filterByAssignee,
	filterBySearch,
	filterByStatus,
	filterReadyTasks,
	filterTaskList,
	parseStatusFilter,
	withBlocks
} from './task-filters.js';

describe('filterByStatus', () => {
	const tasks = [
		createTask({ id: 1, title: 'Task 1', status: 'done' }),
		createTask({ id: 2, title: 'Task 2', status: 'pending' }),
		createTask({ id: 3, title: 'Task 3', status: 'review' })
	];
	const ids = (filtered: typeof tasks) => filtered.map((task) => task.id);

	it('keeps every task for no status or all', () => {
		expect(ids(filterByStatus(tasks))).toEqual(['1', '2', '3']);
		expect(ids(filterByStatus(tasks, 'all'))).toEqual(['1', '2', '3']);
	});

	it('keeps the tasks with one of the listed statuses', () => {
		expect(ids(filterByStatus(tasks, 'pending'))).toEqual(['2']);
		expect(ids(filterByStatus(tasks, 'pending, review'))).toEqual(['2', '3']);
	});
});

describe('a dependency on a subtask (#657)', () => {
	const tasks = [
		createTask({
			id: 1,
			title: 'Parent',
			status: 'review',
			subtasks: [
				createSubtask({ id: 1, title: 'Sub', parentId: '1', status: 'done' })
			]
		}),
		createTask({ id: 2, title: 'Waiting', dependencies: ['1.1', '1.9'] })
	];

	it('is not reported as a non-existent task', () => {
		expect(buildBlocksMap(tasks).invalidDependencies).toEqual([
			{ taskId: '2', depId: '1.9' }
		]);
	});

	it('counts toward --ready once the subtask is done', () => {
		const withBlocks = [
			{ ...tasks[0], blocks: [] },
			{ ...tasks[1], dependencies: ['1.1'], blocks: [] }
		];

		expect(filterReadyTasks(withBlocks).map((task) => task.id)).toEqual([
			'1',
			'2'
		]);
	});
});

describe('parseStatusFilter', () => {
	it('gives no statuses for no value or all', () => {
		expect(parseStatusFilter()).toBeUndefined();
		expect(parseStatusFilter('all')).toBeUndefined();
	});

	it('splits and trims the listed statuses', () => {
		expect(parseStatusFilter('pending, review')).toEqual(['pending', 'review']);
	});

	it('refuses an unknown status, naming the valid ones', () => {
		expect(() => parseStatusFilter('pending,bogus')).toThrow(
			'"bogus" isn\'t a status. Use one of: pending, in-progress'
		);
	});
});

describe('filterBySearch', () => {
	const tasks = [
		createTask({ id: 1, title: 'Build the LOGIN api' }),
		createTask({ id: 2, title: 'Dashboard', description: 'Login stats' }),
		createTask({ id: 3, title: 'Schema', details: 'login table' }),
		createTask({ id: 4, title: 'Tests', testStrategy: 'Check LOGIN' }),
		createTask({
			id: 5,
			title: 'Settings page',
			subtasks: [createSubtask({ id: 1, parentId: '5', title: 'Login form' })]
		}),
		createTask({ id: 6, title: 'Write the README' })
	];
	const ids = (filtered: typeof tasks) => filtered.map((task) => task.id);

	it('keeps tasks whose title, description, details, test strategy or a subtask hold the text, any case', () => {
		expect(ids(filterBySearch(tasks, 'login'))).toEqual([
			'1',
			'2',
			'3',
			'4',
			'5'
		]);
		expect(ids(filterBySearch(tasks, 'READme'))).toEqual(['6']);
	});

	it('keeps every task without a search, and none when nothing matches', () => {
		expect(filterBySearch(tasks)).toHaveLength(6);
		expect(filterBySearch(tasks, '')).toHaveLength(6);
		expect(filterBySearch(tasks, 'oauth')).toEqual([]);
	});

	it('skips fields that are not strings, as older files may hold', () => {
		const odd = [
			{ id: '1', title: 7, details: null, subtasks: [null, { title: {} }] },
			{ id: '2', title: 'seven', subtasks: 'none' }
		] as unknown as Task[];

		expect(filterBySearch(odd, 'seven').map((t) => t.id)).toEqual(['2']);
	});
});

describe('filterByAssignee', () => {
	it('keeps tasks assigned to the login, or with a subtask assigned to it', () => {
		const tasks = [
			{ id: '1', assignee: 'Octocat', subtasks: [] },
			{ id: '2', subtasks: [{ id: '1', assignee: 'octocat' }] },
			{ id: '3', assignee: 'hubot', subtasks: [] }
		] as unknown as Task[];

		expect(filterByAssignee(tasks, 'octocat').map((t) => t.id)).toEqual([
			'1',
			'2'
		]);
		expect(filterByAssignee(tasks)).toHaveLength(3);
	});

	it('skips an assignee that is not a string (#860)', () => {
		const tasks = [
			{ id: '1', assignee: 5, subtasks: [{ id: '1', assignee: {} }] },
			{ id: '2', assignee: 'octocat', subtasks: [] }
		] as unknown as Task[];

		expect(filterByAssignee(tasks, 'octocat').map((t) => t.id)).toEqual(['2']);
	});
});

describe('withBlocks', () => {
	it('adds the IDs of the dependents and reports dependencies on no task', () => {
		const { tasks, invalidDependencies } = withBlocks([
			createTask({ id: 1, title: 'Base' }),
			createTask({ id: 2, title: 'Uses base', dependencies: ['1', '9'] })
		]);

		expect(tasks.map((task) => task.blocks)).toEqual([['2'], []]);
		expect(invalidDependencies).toEqual([{ taskId: '2', depId: '9' }]);
	});

	it('does not report a dependency on an archived task', () => {
		const { invalidDependencies } = withBlocks(
			[createTask({ id: 2, title: 'Uses archived', dependencies: ['1'] })],
			new Set(['1'])
		);

		expect(invalidDependencies).toEqual([]);
	});
});

describe('filterTaskList', () => {
	const { tasks } = withBlocks([
		createTask({ id: 1, title: 'Done base', status: 'done' }),
		createTask({
			id: 2,
			title: 'Ready',
			status: 'pending',
			dependencies: ['1'],
			subtasks: [createSubtask({ id: 1, title: 'Login form', parentId: '2' })]
		}),
		createTask({
			id: 3,
			title: 'Waiting',
			status: 'pending',
			dependencies: ['2']
		})
	]);
	const ids = (filtered: typeof tasks) => filtered.map((task) => task.id);

	it('keeps every task and drops subtasks with no filters', () => {
		const filtered = filterTaskList(tasks, {});

		expect(ids(filtered)).toEqual(['1', '2', '3']);
		expect(filtered[1].subtasks).toEqual([]);
	});

	it('judges ready and blocking against every task, before the status filter', () => {
		expect(ids(filterTaskList(tasks, { ready: true }))).toEqual(['2']);
		expect(
			ids(filterTaskList(tasks, { blocking: true, status: 'pending' }))
		).toEqual(['2']);
	});

	it('counts an archived dependency as done for ready', () => {
		const { tasks: archived } = withBlocks([
			createTask({ id: 5, title: 'After', dependencies: ['4'] })
		]);

		expect(ids(filterTaskList(archived, { ready: true }))).toEqual([]);
		expect(
			ids(
				filterTaskList(archived, { ready: true, archivedIds: new Set(['4']) })
			)
		).toEqual(['5']);
	});

	it('matches search on a subtask, then keeps subtasks only when asked', () => {
		expect(ids(filterTaskList(tasks, { search: 'LOGIN' }))).toEqual(['2']);
		expect(
			filterTaskList(tasks, { search: 'login', withSubtasks: true })[0].subtasks
		).toHaveLength(1);
	});
});
