/**
 * @fileoverview What a clean merge must still hold: a parent's status follows
 * its merged subtasks and no dependency names a removed task (#1093), and a
 * task restored from the archive keeps its ID (#1094)
 */

import { describe, expect, it } from 'vitest';
import { mergeTasksJson } from './merge-tasks-json.js';

type Json = Record<string, any>;

const task = (id: number, extra: Json = {}): Json => ({
	id,
	title: `Task ${id}`,
	status: 'pending',
	dependencies: [],
	subtasks: [],
	...extra
});

const sub = (id: number, status = 'pending'): Json => ({
	id,
	title: `Subtask ${id}`,
	status,
	dependencies: []
});

const file = (tasks: Json[]): Json => ({ master: { tasks, metadata: {} } });

const byId = (merged: unknown, id: number) =>
	(merged as Json).master.tasks.find((t: Json) => t.id === id);

const archive = (tasks: Json[]) => ({
	master: {
		tasks: tasks.map((t) => ({ ...t, archivedAt: '2026-02-01T00:00:00.000Z' })),
		metadata: { highestId: Math.max(...tasks.map((t) => t.id)) }
	}
});

describe('mergeTasksJson settles parents', () => {
	const parent = (status: string, subtasks: Json[], extra: Json = {}) =>
		task(3, { status, subtasks, ...extra });

	it('reopens a parent one branch finished while the other added a subtask', () => {
		const base = file([parent('in-progress', [sub(1, 'done'), sub(2)])]);
		// set-status 3.2 done: the parent follows
		const ours = file([parent('done', [sub(1, 'done'), sub(2, 'done')])]);
		// add-subtask --parent 3
		const theirs = file([
			parent('in-progress', [sub(1, 'done'), sub(2), sub(3)])
		]);

		const result = mergeTasksJson(base, ours, theirs);

		expect(result.conflicts).toEqual([]);
		expect(byId(result.merged, 3).subtasks.map((s: Json) => s.status)).toEqual([
			'done',
			'done',
			'pending'
		]);
		expect(byId(result.merged, 3).status).toBe('in-progress');
	});

	it('finishes a parent when each branch finished a different subtask', () => {
		const base = file([parent('in-progress', [sub(1), sub(2)])]);
		const ours = file([parent('in-progress', [sub(1, 'done'), sub(2)])]);
		const theirs = file([parent('in-progress', [sub(1), sub(2, 'done')])]);

		const result = mergeTasksJson(base, ours, theirs);

		expect(result.conflicts).toEqual([]);
		expect(byId(result.merged, 3).status).toBe('done');
	});

	it("leaves it in progress while the parent's own checklist is open", () => {
		const base = file([parent('in-progress', [sub(1), sub(2)])]);
		const ours = file([parent('in-progress', [sub(1, 'done'), sub(2)])]);
		const theirs = file([parent('in-progress', [sub(1), sub(2, 'done')])]);

		const result = mergeTasksJson(base, ours, theirs, {
			definitionOfDone: ['Docs updated']
		});

		expect(byId(result.merged, 3).status).toBe('in-progress');
	});

	it('keeps a status one branch set on purpose when the other left the task alone', () => {
		const base = file([parent('in-progress', [sub(1), sub(2)]), task(4)]);
		// set-status 3.1 in-progress, then set-status 3 done over open subtasks
		const ours = file([
			parent('done', [sub(1, 'in-progress'), sub(2)]),
			task(4)
		]);
		const theirs = file([
			parent('in-progress', [sub(1), sub(2)]),
			task(4, { title: 'Renamed' })
		]);

		const result = mergeTasksJson(base, ours, theirs);

		expect(byId(result.merged, 3).status).toBe('done');
	});

	it("doesn't change the files it was given", () => {
		const base = file([parent('in-progress', [sub(1), sub(2)])]);
		const ours = file([parent('in-progress', [sub(1, 'done'), sub(2)])]);
		const theirs = file([parent('in-progress', [sub(1), sub(2, 'done')])]);
		const before = structuredClone([ours, theirs]);

		mergeTasksJson(base, ours, theirs);

		expect([ours, theirs]).toEqual(before);
	});
});

describe('mergeTasksJson drops dependencies on removed tasks', () => {
	it('drops a dependency the incoming branch added on a task this branch removed', () => {
		const base = file([task(1), task(2)]);
		// remove-task 2
		const ours = file([task(1)]);
		const theirs = file([
			task(1),
			task(2),
			task(3, {
				dependencies: ['1', '2'],
				subtasks: [{ ...sub(1), dependencies: ['2'] }]
			})
		]);

		const result = mergeTasksJson(base, ours, theirs);

		expect(result.conflicts).toEqual([]);
		expect(byId(result.merged, 3).dependencies).toEqual(['1']);
		expect(byId(result.merged, 3).subtasks[0].dependencies).toEqual([]);
		expect(result.droppedDependencies).toEqual([
			{ tag: 'master', id: '3', dependency: '2' },
			{ tag: 'master', id: '3.1', dependency: '2' }
		]);
		expect(byId(theirs, 3).dependencies).toEqual(['1', '2']);
	});

	it('keeps a dependency on a task this branch archived', () => {
		const base = file([task(1), task(2, { status: 'done' })]);
		const ours = file([task(1)]);
		const theirs = file([
			task(1),
			task(2, { status: 'done' }),
			task(3, { dependencies: ['2'] })
		]);

		const result = mergeTasksJson(base, ours, theirs, {
			archive: archive([task(2, { status: 'done' })])
		});

		expect(byId(result.merged, 3).dependencies).toEqual(['2']);
		expect(result.droppedDependencies).toEqual([]);
	});

	it('keeps dependencies on a task the incoming branch archived', () => {
		// This branch's archive.json doesn't hold task 2 yet
		const base = file([task(1, { dependencies: ['2'] }), task(2)]);
		const ours = file([
			task(1, { dependencies: ['2'] }),
			task(2),
			task(3, { dependencies: ['2'] })
		]);
		const theirs = file([task(1, { dependencies: ['2'] })]);

		const result = mergeTasksJson(base, ours, theirs);

		expect(byId(result.merged, 1).dependencies).toEqual(['2']);
		expect(byId(result.merged, 3).dependencies).toEqual(['2']);
		expect(result.droppedDependencies).toEqual([]);
	});
});

describe('mergeTasksJson with a task restored from the archive', () => {
	const archived = task(2, {
		status: 'done',
		createdAt: '2026-01-05T00:00:00.000Z',
		updatedAt: '2026-01-06T00:00:00.000Z'
	});

	it('keeps its ID when the incoming branch changed it after the restore', () => {
		const base = file([task(1), task(3, { dependencies: ['2'] })]);
		const ours = file([
			task(1, { title: 'Edited here' }),
			task(3, { dependencies: ['2'] })
		]);
		// archive restore 2, then set-status 2 in-progress
		const theirs = file([
			task(1),
			{
				...archived,
				status: 'in-progress',
				updatedAt: '2026-03-01T00:00:00.000Z'
			},
			task(3, { dependencies: ['2'] })
		]);

		const result = mergeTasksJson(base, ours, theirs, {
			archive: archive([archived])
		});

		expect(result.renumbered).toEqual([]);
		expect(byId(result.merged, 2).status).toBe('in-progress');
		expect(byId(result.merged, 3).dependencies).toEqual(['2']);
	});

	it('still moves a different task that took the archived ID', () => {
		const base = file([task(1)]);
		const ours = file([task(1, { title: 'Edited here' })]);
		const theirs = file([
			task(1),
			// Same title, created later: not the archived task
			{ ...archived, status: 'pending', createdAt: '2026-03-01T00:00:00.000Z' }
		]);

		const result = mergeTasksJson(base, ours, theirs, {
			archive: archive([archived])
		});

		expect(result.renumbered).toEqual([{ tag: 'master', from: '2', to: '3' }]);
	});

	it('moves a changed task when neither copy records when it was created', () => {
		const { createdAt: _createdAt, ...undated } = archived;
		const base = file([task(1)]);
		const ours = file([task(1, { title: 'Edited here' })]);
		const theirs = file([task(1), { ...undated, status: 'pending' }]);

		const result = mergeTasksJson(base, ours, theirs, {
			archive: archive([undated])
		});

		expect(result.renumbered).toEqual([{ tag: 'master', from: '2', to: '3' }]);
	});
});
