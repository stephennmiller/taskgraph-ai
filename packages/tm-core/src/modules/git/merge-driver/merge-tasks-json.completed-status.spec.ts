/**
 * @fileoverview The older 'completed' status reads as 'done' in the merge, so
 * a save that only rewrote it on one branch is not a change
 */

import { describe, expect, it } from 'vitest';
import { mergeTasksJson } from './merge-tasks-json.js';

type Json = Record<string, any>;

const task = (id: number, status: string, extra: Json = {}): Json => ({
	id,
	title: `Task ${id}`,
	status,
	dependencies: [],
	subtasks: [],
	...extra
});

const file = (tasks: Json[]): Json => ({ master: { tasks, metadata: {} } });

const tasksOf = (merged: unknown): Json[] => (merged as Json).master.tasks;

describe("mergeTasksJson with the older 'completed' status", () => {
	it("takes the other branch's status change without a conflict", () => {
		const sub = (status: string) => ({ id: 1, title: 'Sub', status });
		const base = file([task(1, 'completed', { subtasks: [sub('completed')] })]);
		const ours = file([task(1, 'done', { subtasks: [sub('done')] })]);
		const theirs = file([
			task(1, 'in-progress', { subtasks: [sub('completed')] })
		]);

		const result = mergeTasksJson(base, ours, theirs);

		expect(result.conflicts).toEqual([]);
		expect(tasksOf(result.merged)[0].status).toBe('in-progress');
		expect(tasksOf(result.merged)[0].subtasks[0].status).toBe('done');
	});

	it("reads a subtask ID with its task's prefix as the saved bare one, so it is no change (#805)", () => {
		const sub = (id: string, status: string) => ({ id, title: 'Sub', status });
		const base = file([
			task(1, 'pending', { subtasks: [sub('1.2', 'pending')] })
		]);
		const ours = file([task(1, 'pending', { subtasks: [sub('2', 'done')] })]);
		const theirs = file([
			task(1, 'in-progress', { subtasks: [sub('1.2', 'pending')] })
		]);

		const result = mergeTasksJson(base, ours, theirs);

		expect(result.conflicts).toEqual([]);
		expect(tasksOf(result.merged)[0].status).toBe('in-progress');
		expect(tasksOf(result.merged)[0].subtasks).toEqual([sub('2', 'done')]);
	});

	it('keeps a task restored from an archive that says completed at its ID', () => {
		const archive = {
			master: {
				tasks: [
					task(5, 'completed', { archivedAt: '2026-01-01T00:00:00.000Z' })
				],
				metadata: { highestId: 5 }
			}
		};

		const result = mergeTasksJson(file([]), file([]), file([task(5, 'done')]), {
			archive
		});

		expect(result.renumbered).toEqual([]);
		expect(tasksOf(result.merged).map((t) => t.id)).toEqual([5]);
	});
});
