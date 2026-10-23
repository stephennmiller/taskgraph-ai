import { describe, expect, it } from 'vitest';
import { mergeTasksJson } from './merge-tasks-json.js';

type Json = Record<string, any>;

const task = (id: number, extra: Json = {}): Json => ({
	id,
	title: `Task ${id}`,
	description: '',
	status: 'pending',
	priority: 'medium',
	dependencies: [],
	details: '',
	testStrategy: '',
	subtasks: [],
	...extra
});

const sub = (id: number, extra: Json = {}): Json => ({
	id,
	title: `Subtask ${id}`,
	status: 'pending',
	dependencies: [],
	...extra
});

const file = (tags: Record<string, Json[]>): Json =>
	Object.fromEntries(
		Object.entries(tags).map(([tag, tasks]) => [
			tag,
			{ tasks, metadata: { created: '2026-01-01T00:00:00.000Z' } }
		])
	);

const tasksOf = (merged: unknown, tag = 'master'): Json[] =>
	(merged as Json)[tag].tasks;

const byId = (merged: unknown, id: number, tag = 'master') =>
	tasksOf(merged, tag).find((t) => t.id === id);

describe('mergeTasksJson', () => {
	it('keeps both sides when they changed different tasks', () => {
		const base = file({ master: [task(1), task(2)] });
		const ours = file({ master: [task(1), task(2), task(3)] });
		const theirs = file({
			master: [task(1, { status: 'done' }), task(2)]
		});

		const result = mergeTasksJson(base, ours, theirs);

		expect(result.renumbered).toEqual([]);
		expect(result.conflicts).toEqual([]);
		expect(tasksOf(result.merged).map((t) => t.id)).toEqual([1, 2, 3]);
		expect(byId(result.merged, 1)?.status).toBe('done');
	});

	it('returns the unchanged side when only one side changed', () => {
		const base = file({ master: [task(1)] });
		const theirs = file({ master: [task(1), task(2)] });

		const result = mergeTasksJson(base, base, theirs);

		expect(result.merged).toEqual(theirs);
	});

	it('renumbers an incoming task that took the same new ID and moves its dependents', () => {
		const base = file({ master: [task(1), task(2)] });
		const ours = file({
			master: [task(1), task(2), task(3, { title: 'Ours: login page' })]
		});
		const theirs = file({
			master: [
				task(1),
				// An existing task the incoming branch made depend on its new one
				task(2, { dependencies: ['3'] }),
				task(3, { title: 'Theirs: billing' }),
				task(4, {
					dependencies: [3, 1],
					metadata: { dependencySources: { '3': 'inferred' } }
				})
			]
		});

		const result = mergeTasksJson(base, ours, theirs);

		expect(result.renumbered).toEqual([{ tag: 'master', from: '3', to: '5' }]);
		expect(result.conflicts).toEqual([]);
		const merged = tasksOf(result.merged);
		expect(merged.map((t) => [t.id, t.title])).toEqual([
			[1, 'Task 1'],
			[2, 'Task 2'],
			[3, 'Ours: login page'],
			[4, 'Task 4'],
			[5, 'Theirs: billing']
		]);
		// Stored forms are kept: a string stays a string, a number a number
		expect(byId(result.merged, 2)?.dependencies).toEqual(['5']);
		expect(byId(result.merged, 4)?.dependencies).toEqual([5, 1]);
		expect(byId(result.merged, 4)?.metadata).toEqual({
			dependencySources: { '5': 'inferred' }
		});
	});

	it('moves related and discovered-from links to a renumbered incoming task', () => {
		const base = file({ master: [task(1)] });
		const ours = file({ master: [task(1), task(2, { title: 'Ours' })] });
		const theirs = file({
			master: [
				task(1, { metadata: { taskLinks: { '2': 'related' } } }),
				task(2, {
					title: 'Theirs',
					subtasks: [{ id: 1, title: 'Sub', status: 'pending' }]
				}),
				task(3, {
					metadata: {
						owner: 'kim',
						taskLinks: { '2.1': 'discovered-from', '1': 'related' }
					}
				})
			]
		});

		const result = mergeTasksJson(base, ours, theirs);

		expect(result.renumbered).toContainEqual({
			tag: 'master',
			from: '2',
			to: '4'
		});
		expect(byId(result.merged, 1)?.metadata).toEqual({
			taskLinks: { '4': 'related' }
		});
		const incoming = tasksOf(result.merged).find(
			(t) => (t.metadata as any)?.owner === 'kim'
		);
		expect(incoming?.metadata).toEqual({
			owner: 'kim',
			taskLinks: { '4.1': 'discovered-from', '1': 'related' }
		});
	});

	it('keeps one copy when both sides added the identical task', () => {
		const base = file({ master: [task(1)] });
		const both = file({ master: [task(1), task(2, { title: 'Same' })] });

		const result = mergeTasksJson(base, both, structuredClone(both));

		expect(result.renumbered).toEqual([]);
		expect(tasksOf(result.merged)).toHaveLength(2);
	});

	describe('subtasks', () => {
		it('renumbers an incoming subtask that took the same new ID, and its sibling dependencies', () => {
			const base = file({ master: [task(1, { subtasks: [sub(1)] })] });
			const ours = file({
				master: [
					task(1, { subtasks: [sub(1), sub(2, { title: 'Ours: schema' })] })
				]
			});
			const theirs = file({
				master: [
					task(1, {
						subtasks: [
							sub(1),
							sub(2, { title: 'Theirs: API' }),
							sub(3, {
								dependencies: [2, '1.2'],
								metadata: { dependencySources: { '1.2': 'inferred' } }
							})
						]
					}),
					task(2, { dependencies: ['1.2'] })
				]
			});

			const result = mergeTasksJson(base, ours, theirs);

			expect(result.renumbered).toEqual([
				{ tag: 'master', from: '1.2', to: '1.4' }
			]);
			const subtasks = byId(result.merged, 1)?.subtasks;
			expect(subtasks.map((s: Json) => [s.id, s.title])).toEqual([
				[1, 'Subtask 1'],
				[2, 'Ours: schema'],
				[3, 'Subtask 3'],
				[4, 'Theirs: API']
			]);
			expect(subtasks[2].dependencies).toEqual([4, '1.4']);
			expect(subtasks[2].metadata).toEqual({
				dependencySources: { '1.4': 'inferred' }
			});
			expect(byId(result.merged, 2)?.dependencies).toEqual(['1.4']);
		});

		it("moves a renumbered task's subtasks with it, including parentId and dotted references", () => {
			const base = file({ master: [task(1)] });
			const ours = file({ master: [task(1), task(2)] });
			const theirs = file({
				master: [
					task(1),
					task(2, {
						title: 'Theirs',
						subtasks: [
							sub(1, { parentId: '2' }),
							sub(2, { parentId: '2', dependencies: [1, '2.1'] })
						]
					}),
					task(3, { dependencies: ['2.2'] })
				]
			});

			const result = mergeTasksJson(base, ours, theirs);

			expect(result.renumbered).toEqual([
				{ tag: 'master', from: '2', to: '4' }
			]);
			const moved = byId(result.merged, 4);
			expect(moved?.subtasks.map((s: Json) => s.parentId)).toEqual(['4', '4']);
			// A sibling number is relative to the parent and stays as it was
			expect(moved?.subtasks[1].dependencies).toEqual([1, '4.1']);
			expect(byId(result.merged, 3)?.dependencies).toEqual(['4.2']);
		});

		it('merges subtask changes made on different sides', () => {
			const base = file({ master: [task(1, { subtasks: [sub(1), sub(2)] })] });
			const ours = file({
				master: [task(1, { subtasks: [sub(1, { status: 'done' }), sub(2)] })]
			});
			const theirs = file({
				master: [
					task(1, { subtasks: [sub(1), sub(2, { status: 'in-progress' })] })
				]
			});

			const result = mergeTasksJson(base, ours, theirs);

			expect(result.conflicts).toEqual([]);
			expect(
				byId(result.merged, 1)?.subtasks.map((s: Json) => s.status)
			).toEqual(['done', 'in-progress']);
		});
	});

	describe('tags', () => {
		it('merges each tag on its own and reports which tag was renumbered', () => {
			const base = file({ master: [task(1)], feature: [task(1)] });
			const ours = file({
				master: [task(1), task(2, { title: 'Ours' })],
				feature: [task(1)],
				'ours-only': [task(1)]
			});
			const theirs = file({
				master: [task(1)],
				feature: [task(1), task(2, { title: 'Theirs' })],
				'theirs-only': [task(7)]
			});
			theirs.feature.tasks[0].status = 'done';
			ours.feature.tasks.push(task(2, { title: 'Ours in feature' }));

			const result = mergeTasksJson(base, ours, theirs);

			expect(Object.keys(result.merged as Json)).toEqual([
				'master',
				'feature',
				'ours-only',
				'theirs-only'
			]);
			expect(result.renumbered).toEqual([
				{ tag: 'feature', from: '2', to: '3' }
			]);
			expect(tasksOf(result.merged, 'master').map((t) => t.id)).toEqual([1, 2]);
			expect(
				tasksOf(result.merged, 'feature').map((t) => [t.id, t.status])
			).toEqual([
				[1, 'done'],
				[2, 'pending'],
				[3, 'pending']
			]);
			expect(tasksOf(result.merged, 'theirs-only')[0].id).toBe(7);
		});

		it('renumbers within a tag both branches created', () => {
			const ours = file({
				master: [task(1)],
				sprint: [task(1, { title: 'A' })]
			});
			const theirs = file({
				master: [task(1)],
				sprint: [task(1, { title: 'B' })]
			});

			const result = mergeTasksJson(file({ master: [task(1)] }), ours, theirs);

			expect(result.renumbered).toEqual([
				{ tag: 'sprint', from: '1', to: '2' }
			]);
			expect(
				tasksOf(result.merged, 'sprint').map((t) => [t.id, t.title])
			).toEqual([
				[1, 'A'],
				[2, 'B']
			]);
		});

		it('removes a tag one side deleted and the other left alone', () => {
			const base = file({ master: [task(1)], old: [task(1)] });
			const ours = file({ master: [task(1)] });
			const theirs = file({
				master: [task(1, { status: 'done' })],
				old: [task(1)]
			});

			const result = mergeTasksJson(base, ours, theirs);

			expect(Object.keys(result.merged as Json)).toEqual(['master']);
			expect(result.conflicts).toEqual([]);
		});

		it('keeps the earlier created time when both sides filled it in', () => {
			const base = { master: { tasks: [task(1)], metadata: {} } };
			const ours = {
				master: {
					tasks: [task(1)],
					metadata: { created: '2026-02-01T00:00:00Z' }
				}
			};
			const theirs = {
				master: {
					tasks: [task(1, { status: 'done' })],
					metadata: { created: '2026-01-01T00:00:00Z' }
				}
			};

			const result = mergeTasksJson(base, ours, theirs);

			expect(result.conflicts).toEqual([]);
			expect((result.merged as Json).master.metadata.created).toBe(
				'2026-01-01T00:00:00Z'
			);
		});

		it('recounts taskCount and completedCount in tag metadata', () => {
			const meta = (taskCount: number, completedCount: number) => ({
				taskCount,
				completedCount,
				lastModified: '2026-01-01T00:00:00.000Z'
			});
			const base = { master: { tasks: [task(1)], metadata: meta(1, 0) } };
			const ours = {
				master: {
					tasks: [task(1), task(2)],
					metadata: { ...meta(2, 0), lastModified: '2026-02-01T00:00:00.000Z' }
				}
			};
			const theirs = {
				master: {
					tasks: [task(1, { status: 'done' })],
					metadata: { ...meta(1, 1), lastModified: '2026-03-01T00:00:00.000Z' }
				}
			};

			const result = mergeTasksJson(base, ours, theirs);

			expect(result.conflicts).toEqual([]);
			expect((result.merged as Json).master.metadata).toEqual({
				taskCount: 2,
				completedCount: 1,
				lastModified: '2026-03-01T00:00:00.000Z'
			});
		});
	});

	describe('both sides edit the same task', () => {
		it('merges different fields, both dependency additions, later timestamps and appended details', () => {
			const base = file({
				master: [
					task(1),
					task(2),
					task(3),
					task(4, {
						details: 'Plan',
						dependencies: [1],
						updatedAt: '2026-01-01T00:00:00.000Z'
					})
				]
			});
			const ours = structuredClone(base);
			Object.assign(ours.master.tasks[3], {
				status: 'done',
				details: 'Plan\nOurs note',
				dependencies: [1, 2],
				updatedAt: '2026-01-03T00:00:00.000Z'
			});
			const theirs = structuredClone(base);
			Object.assign(theirs.master.tasks[3], {
				priority: 'high',
				details: 'Plan\nTheirs note',
				dependencies: [3],
				updatedAt: '2026-01-02T00:00:00.000Z'
			});

			const result = mergeTasksJson(base, ours, theirs);

			expect(result.conflicts).toEqual([]);
			expect(byId(result.merged, 4)).toMatchObject({
				status: 'done',
				priority: 'high',
				details: 'Plan\nOurs note\nTheirs note',
				dependencies: [2, 3],
				updatedAt: '2026-01-03T00:00:00.000Z'
			});
		});

		it("reports the same field changed both ways and keeps the current branch's value", () => {
			const base = file({ master: [task(1, { subtasks: [sub(1)] })] });
			const ours = file({
				master: [
					task(1, {
						status: 'done',
						title: 'Ours',
						subtasks: [sub(1, { title: 'Ours sub' })]
					})
				]
			});
			const theirs = file({
				master: [
					task(1, {
						status: 'in-progress',
						title: 'Task 1',
						subtasks: [sub(1, { title: 'Theirs sub' })]
					})
				]
			});

			const result = mergeTasksJson(base, ours, theirs);

			expect(result.conflicts).toEqual([
				{
					tag: 'master',
					id: '1',
					field: 'status',
					kind: 'changed-both',
					ours: 'done',
					theirs: 'in-progress'
				},
				{
					tag: 'master',
					id: '1.1',
					field: 'title',
					kind: 'changed-both',
					ours: 'Ours sub',
					theirs: 'Theirs sub'
				}
			]);
			expect(byId(result.merged, 1)).toMatchObject({
				status: 'done',
				title: 'Ours'
			});
		});

		it('keeps a task one side removed and the other changed, as a conflict', () => {
			const base = file({ master: [task(1), task(2)] });
			const ours = file({ master: [task(1)] });
			const theirs = file({ master: [task(1), task(2, { status: 'done' })] });

			const result = mergeTasksJson(base, ours, theirs);

			expect(result.conflicts).toEqual([
				expect.objectContaining({
					tag: 'master',
					id: '2',
					field: '',
					kind: 'removed-ours'
				})
			]);
			expect(byId(result.merged, 2)?.status).toBe('done');
		});

		it('drops a task one side removed and the other left alone', () => {
			const base = file({ master: [task(1), task(2)] });
			const ours = file({ master: [task(1, { status: 'done' }), task(2)] });
			const theirs = file({ master: [task(1)] });

			const result = mergeTasksJson(base, ours, theirs);

			expect(result.conflicts).toEqual([]);
			expect(tasksOf(result.merged).map((t) => t.id)).toEqual([1]);
		});
	});

	it('merges a legacy { tasks } file and writes it back in the same shape', () => {
		const base = { tasks: [task(1)] };
		const ours = { tasks: [task(1), task(2, { title: 'Ours' })] };
		const theirs = { tasks: [task(1), task(2, { title: 'Theirs' })] };

		const result = mergeTasksJson(base, ours, theirs);

		expect(result.renumbered).toEqual([{ tag: 'master', from: '2', to: '3' }]);
		expect((result.merged as Json).tasks.map((t: Json) => t.id)).toEqual([
			1, 2, 3
		]);
	});

	it('treats a missing ancestor as both sides adding the file', () => {
		const ours = file({ master: [task(1, { title: 'A' })] });
		const theirs = file({ master: [task(1, { title: 'B' })] });

		const result = mergeTasksJson(undefined, ours, theirs);

		expect(result.renumbered).toEqual([{ tag: 'master', from: '1', to: '2' }]);
		expect(tasksOf(result.merged)).toHaveLength(2);
	});

	it('keeps keys such as __proto__ as data', () => {
		const base = JSON.parse('{"master":{"tasks":[]}}');
		const ours = JSON.parse('{"master":{"tasks":[],"__proto__":{"x":1}}}');
		const theirs = JSON.parse('{"master":{"tasks":[],"y":2}}');

		const result = mergeTasksJson(base, ours, theirs);

		expect(JSON.stringify(result.merged)).toBe(
			'{"master":{"tasks":[],"__proto__":{"x":1},"y":2}}'
		);
	});

	describe('hostile or damaged input', () => {
		it('keeps a task and the prototype clean when a task has a __proto__ key', () => {
			const ours = JSON.parse(
				'{"master":{"tasks":[{"id":1,"title":"A","__proto__":{"polluted":1}}]}}'
			);
			const theirs = JSON.parse(
				'{"master":{"tasks":[{"id":1,"title":"B","__proto__":{"polluted":2}}]}}'
			);

			const result = mergeTasksJson(undefined, ours, theirs);

			expect(({} as Json).polluted).toBeUndefined();
			expect(tasksOf(result.merged).map((t) => t.title)).toEqual(['A', 'B']);
			expect(JSON.stringify(byId(result.merged, 2))).toBe(
				'{"id":2,"title":"B","__proto__":{"polluted":2}}'
			);
		});

		it('reports a clash instead of collapsing tasks that share an ID', () => {
			const base = file({ master: [task(1)] });
			const ours = file({ master: [task(1), task(5, { title: 'Ours' })] });
			const theirs = file({
				master: [task(1), task(5, { title: 'X' }), task(5, { title: 'Y' })]
			});

			const result = mergeTasksJson(base, ours, theirs);

			expect(result.conflicts).toEqual([
				expect.objectContaining({ field: 'tasks', kind: 'changed-both' })
			]);
			expect(tasksOf(result.merged)).toEqual(tasksOf(ours));
		});

		it('reports a clash instead of renumbering an object ID', () => {
			const ours = file({ master: [task(1), { id: { a: 1 }, title: 'A' }] });
			const theirs = file({ master: [task(1), { id: { b: 2 }, title: 'B' }] });

			const result = mergeTasksJson(file({ master: [task(1)] }), ours, theirs);

			expect(result.renumbered).toEqual([]);
			expect(result.conflicts).toEqual([
				expect.objectContaining({ field: 'tasks', kind: 'changed-both' })
			]);
		});

		it('merges long lists of plain values from both sides', () => {
			const tags = (from: number) =>
				Array.from({ length: 50_000 }, (_, i) => `t${from + i}`);
			const base = file({ master: [task(1, { tags: tags(0) })] });
			const ours = file({ master: [task(1, { tags: tags(1) })] });
			const theirs = file({ master: [task(1, { tags: tags(2) })] });

			const merged = byId(mergeTasksJson(base, ours, theirs).merged, 1);

			// t0 left on both sides, t1 on the incoming one; t50001 arrived there
			expect(merged?.tags).toEqual(tags(2));
		});
	});
});
