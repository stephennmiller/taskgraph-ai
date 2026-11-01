/**
 * moveTasksBetweenTags: which dependencies block a move to another tag, and
 * what withDependencies and ignoreDependencies do with them.
 */

import { describe, expect, it } from 'vitest';
import type { Task } from '../../../common/types/index.js';
import { moveTasksBetweenTags } from './move-between-tags.js';
import { MOVE_ERROR_CODES } from './task-moves.js';
import { ids, noArchive, sample } from './task-moves.fixture.js';

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

	it("brings what a moved task's subtasks depend on with withDependencies (#917)", () => {
		const tags = new Map<string, Task[]>([
			[
				'master',
				[
					{ id: 1, title: 'Set up', dependencies: [], subtasks: [] },
					{
						id: 2,
						title: 'Parser',
						dependencies: [],
						subtasks: [{ id: 1, title: 'Read', dependencies: ['1'] }]
					}
				] as any
			],
			['feature', []]
		]);

		const result = moveTasksBetweenTags(
			tags,
			['2'],
			'master',
			'feature',
			{ withDependencies: true },
			archived
		);

		expect(result.movedTasks.map((m) => String(m.id))).toEqual(['2', '1']);
		expect(ids(tags.get('master') ?? [])).toEqual([]);
	});

	it("follows a subtask dependency to its parent task's dependencies (#917)", () => {
		const tags = new Map<string, Task[]>([
			[
				'master',
				[
					{
						id: 1,
						title: 'Set up',
						dependencies: ['4'],
						subtasks: [{ id: 1, title: 'Read', dependencies: [] }]
					},
					{ id: 3, title: 'Plugins', dependencies: ['1.1'], subtasks: [] },
					{ id: 4, title: 'Config', dependencies: [], subtasks: [] }
				] as any
			],
			['feature', []]
		]);

		const result = moveTasksBetweenTags(
			tags,
			['3'],
			'master',
			'feature',
			{ withDependencies: true },
			archived
		);

		expect(result.movedTasks.map((m) => String(m.id))).toEqual(['3', '1', '4']);
	});

	it('reads a dependency stored as "01" as task 1, which stays behind (#864)', () => {
		const tags = tagsWith();
		tags.set('empty', []);
		(tags.get('master') as any[])[2].dependencies = ['01'];

		let error: any;
		try {
			moveTasksBetweenTags(tags, ['3'], 'master', 'empty', {}, archived);
		} catch (e) {
			error = e;
		}

		expect(error?.context.details.conflicts[0].message).toBe(
			'Task 3 depends on 1 (in master)'
		);
	});

	it('reads "05" as task 5, bringing its dependencies along (#864)', () => {
		const tags = tagsWith();
		tags.set('feature', []);

		const result = moveTasksBetweenTags(
			tags,
			['05'],
			'master',
			'feature',
			{ withDependencies: true },
			archived
		);

		expect(result.movedTasks.map((m) => String(m.id))).toEqual([
			'5',
			'4',
			'2',
			'1',
			'3'
		]);
	});

	it('lists no conflict for "1x" or "1.1x", which name no task, when task 1 moves (#874)', () => {
		const tags = tagsWith();
		tags.set('empty', []);
		const parser = (tags.get('master') as any[])[1];
		parser.dependencies = ['1x'];
		parser.subtasks[1].dependencies = ['1.1x'];

		const result = moveTasksBetweenTags(
			tags,
			['1'],
			'master',
			'empty',
			{},
			archived
		);

		expect(result.movedTasks.map((m) => String(m.id))).toEqual(['1']);
		expect(parser.dependencies).toEqual(['1x']);
		expect(parser.subtasks[1].dependencies).toEqual(['1.1x']);
	});

	it('brings no task along for "1x" with withDependencies (#874)', () => {
		const tags = tagsWith();
		tags.set('empty', []);
		(tags.get('master') as any[])[2].dependencies = ['1x'];

		const result = moveTasksBetweenTags(
			tags,
			['3'],
			'master',
			'empty',
			{ withDependencies: true, ignoreDependencies: true },
			archived
		);

		expect(result.movedTasks.map((m) => String(m.id))).toEqual(['3']);
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

	// feat's task 3 needs feat's 2 and archived 9, its subtask needs feat's 1;
	// master has its own 1, 2 and 9
	const sameIdsInTarget = () =>
		new Map<string, Task[]>([
			[
				'master',
				[
					{ id: '1', title: 'Setup DB', dependencies: [], subtasks: [] },
					{ id: '2', title: 'Write docs', dependencies: [], subtasks: [] },
					{ id: '9', title: 'Ship', dependencies: [], subtasks: [] }
				] as any
			],
			[
				'feat',
				[
					{ id: '1', title: 'Auth API', dependencies: [], subtasks: [] },
					{ id: '2', title: 'Session store', dependencies: [], subtasks: [] },
					{
						id: '3',
						title: 'Login UI',
						dependencies: ['2', '9'],
						subtasks: [{ id: 1, title: 'Form', dependencies: ['1'] }]
					}
				] as any
			]
		]);
	const featArchived = (tag: string) =>
		tag === 'feat' ? new Set(['9']) : noArchive;

	it('refuses a move whose dependencies stay in the source tag, though the target has the same IDs (#801)', () => {
		const tags = sameIdsInTarget();

		let error: any;
		try {
			moveTasksBetweenTags(tags, ['3'], 'feat', 'master', {}, featArchived);
		} catch (e) {
			error = e;
		}

		expect(
			error?.context.details.conflicts.map((c: any) => [c.message, c.archived])
		).toEqual([
			['Task 3 depends on 2 (in feat)', undefined],
			['Task 3 depends on 9 (archived in feat)', true],
			['Task 3.1 depends on 1 (in feat)', undefined]
		]);
		expect(ids(tags.get('master') ?? [])).toEqual(['1', '2', '9']);
	});

	it('drops those dependencies with ignoreDependencies instead of rebinding them (#801)', () => {
		const tags = sameIdsInTarget();

		moveTasksBetweenTags(
			tags,
			['3'],
			'feat',
			'master',
			{ ignoreDependencies: true },
			featArchived
		);

		const moved = tags.get('master')?.find((t) => String(t.id) === '3');
		expect(moved?.dependencies).toEqual([]);
		expect(moved?.subtasks?.[0].dependencies).toEqual([]);
	});

	describe('a dependency the source tag does not have (#864)', () => {
		// master's task 3 depends on 9, which master doesn't have
		const withDangling = (others: Record<string, object[]>) =>
			new Map<string, Task[]>([
				[
					'master',
					[
						{ id: 3, title: 'Plugins', dependencies: ['9'], subtasks: [] }
					] as any
				],
				...Object.entries(others).map(
					([tag, tasks]) => [tag, tasks as any] as [string, Task[]]
				)
			]);
		const nine = [
			{ id: 9, title: 'Unrelated', dependencies: [], subtasks: [] }
		];

		it('moves as it is when the target tag has no such ID', () => {
			// A third tag's 9 isn't the task 3 meant, so it is no conflict
			const tags = withDangling({ feature: [], third: nine });

			moveTasksBetweenTags(tags, ['3'], 'master', 'feature', {}, archived);

			expect(tags.get('feature')?.[0].dependencies).toEqual(['9']);
		});

		it("refuses when the target's own task would take it over", () => {
			const tags = withDangling({ feature: nine });

			let error: any;
			try {
				moveTasksBetweenTags(tags, ['3'], 'master', 'feature', {}, archived);
			} catch (e) {
				error = e;
			}

			expect(error?.context.details.conflicts).toEqual([
				{
					taskId: '3',
					dependencyId: '9',
					dependencyTag: 'master',
					message:
						"Task 3 depends on 9, which master doesn't have (feature has a different 9)",
					missing: true
				}
			]);
			expect(ids(tags.get('feature') ?? [])).toEqual(['9']);
		});

		it('drops it with ignoreDependencies', () => {
			const tags = withDangling({ feature: nine });

			moveTasksBetweenTags(
				tags,
				['3'],
				'master',
				'feature',
				{ ignoreDependencies: true },
				archived
			);

			const moved = tags.get('feature')?.find((t) => String(t.id) === '3');
			expect(moved?.dependencies).toEqual([]);
		});
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
			moveTasksBetweenTags(tags, ['3'], 'master', 'tasks', {}, archived)
		).toThrow('"tasks" is a reserved tag name');
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
