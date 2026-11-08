/**
 * @fileoverview A task removed on one branch whose ID that branch handed out
 * again: the tag's `metadata.highestId` keeps the IDs apart (#1040)
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

const file = (tasks: Json[], highestId?: number): Json => ({
	master: { tasks, metadata: highestId ? { highestId } : {} }
});

const byId = (merged: unknown, id: number) =>
	(merged as Json).master.tasks.find((t: Json) => t.id === id);

describe('mergeTasksJson with a removed task', () => {
	it("reports the other branch's edit against the removed task, not the new one", () => {
		const base = file([task(1), task(2, { title: 'Old feature' })]);
		// remove-task 2, then add-task: the high-water mark gives it 3
		const ours = file([task(1), task(3, { title: 'Brand new work' })], 3);
		// A loop worktree finished the old task 2
		const theirs = file(
			[task(1), task(2, { title: 'Old feature', status: 'done' })],
			2
		);

		const result = mergeTasksJson(base, ours, theirs);

		expect(byId(result.merged, 3)).toMatchObject({
			title: 'Brand new work',
			status: 'pending'
		});
		expect(result.conflicts).toEqual([
			expect.objectContaining({ id: '2', kind: 'removed-ours' })
		]);
		expect((result.merged as Json).master.metadata.highestId).toBe(3);
	});

	it('moves an incoming new task off an ID this branch used and removed', () => {
		const base = file([task(1)]);
		// Added task 2, then removed it
		const ours = file([task(1)], 2);
		const theirs = file([task(1), task(2, { title: 'Theirs' })], 2);

		const result = mergeTasksJson(base, ours, theirs);

		expect(result.renumbered).toEqual([{ tag: 'master', from: '2', to: '3' }]);
		expect(byId(result.merged, 3)?.title).toBe('Theirs');
	});
});
