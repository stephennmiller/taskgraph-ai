import { describe, expect, it } from 'vitest';
import { mergeArchiveJson } from './merge-archive-json.js';

type Json = Record<string, any>;

const task = (id: number, extra: Json = {}): Json => ({
	id,
	title: `Task ${id}`,
	status: 'pending',
	dependencies: [],
	subtasks: [],
	...extra
});

/** A tasks.json with these tasks in master */
const file = (tags: Record<string, Json[]>): Json =>
	Object.fromEntries(
		Object.entries(tags).map(([tag, tasks]) => [tag, { tasks, metadata: {} }])
	);

describe('mergeArchiveJson', () => {
	const archived = (id: number, archivedAt: string, extra: Json = {}) =>
		task(id, { status: 'done', archivedAt, ...extra });
	const archive = (tasks: Json[], highestId: number, lastModified = 'x') => ({
		master: { tasks, metadata: { highestId, lastModified } }
	});
	const jan = '2026-01-01T00:00:00.000Z';
	const feb = '2026-02-01T00:00:00.000Z';
	const mar = '2026-03-01T00:00:00.000Z';

	it("keeps both branches' archived tasks and the higher highestId", () => {
		const base = archive([archived(1, jan)], 1, jan);
		const ours = archive([archived(1, jan), archived(2, feb)], 2, feb);
		const theirs = archive([archived(1, jan), archived(4, mar)], 4, mar);

		const result = mergeArchiveJson(base, ours, theirs);

		expect(result.conflicts).toEqual([]);
		expect(result.renumbered).toEqual([]);
		expect(result.merged).toEqual(
			archive([archived(1, jan), archived(2, feb), archived(4, mar)], 4, mar)
		);
	});

	it("reads the older 'completed' as 'done', so a save that only rewrote it isn't a change", () => {
		const base = archive([archived(1, jan, { status: 'completed' })], 1, jan);
		const ours = archive([archived(1, jan)], 1, jan);
		const theirs = archive([archived(1, jan, { status: 'cancelled' })], 1, jan);

		const result = mergeArchiveJson(base, ours, theirs);

		expect(result.conflicts).toEqual([]);
		expect(result.merged).toEqual(
			archive([archived(1, jan, { status: 'cancelled' })], 1, jan)
		);
	});

	it('merges a task both branches archived, keeping the earlier archivedAt', () => {
		const base = archive([], 0);
		const ours = archive([archived(3, mar)], 3);
		const theirs = archive([archived(3, feb)], 3);

		const result = mergeArchiveJson(base, ours, theirs);

		expect(result.conflicts).toEqual([]);
		expect(result.merged).toEqual(archive([archived(3, feb)], 3));
	});

	it('reports two different tasks archived under one ID instead of renumbering', () => {
		const base = archive([], 0);
		const ours = archive([archived(3, feb, { title: 'Ours' })], 3);
		const theirs = archive([archived(3, feb, { title: 'Theirs' })], 3);

		const result = mergeArchiveJson(base, ours, theirs);

		expect(result.renumbered).toEqual([]);
		expect(result.conflicts).toEqual([
			{
				tag: 'master',
				id: '3',
				field: 'title',
				kind: 'changed-both',
				ours: 'Ours',
				theirs: 'Theirs'
			}
		]);
	});

	it("reports an incoming archived task whose ID this branch's tasks.json reused", () => {
		// Theirs added 9 and archived it; ours added its own 9
		const base = archive([archived(1, jan)], 1);
		const ours = archive([archived(1, jan), archived(2, feb)], 2);
		const theirs = archive(
			[archived(1, jan), archived(9, feb, { title: 'Theirs' })],
			9
		);
		const oursLive = task(9, { title: 'Ours' });

		const result = mergeArchiveJson(base, ours, theirs, {
			tasks: file({ master: [task(8), oursLive] })
		});

		expect(result.conflicts).toEqual([
			{
				tag: 'master',
				id: '9',
				field: '',
				kind: 'archived-theirs',
				ours: oursLive,
				theirs: task(9, { title: 'Theirs', status: 'done' })
			}
		]);
		// Nothing is dropped: the archived task is in the merged archive
		expect((result.merged as Json).master.tasks.map((t: Json) => t.id)).toEqual(
			[1, 2, 9]
		);
	});

	it('accepts the incoming branch archiving a task this branch still has', () => {
		const base = archive([], 0);
		const ours = archive([archived(1, jan)], 1);
		const theirs = archive([archived(5, feb)], 5);

		const result = mergeArchiveJson(base, ours, theirs, {
			tasks: file({ master: [task(5, { status: 'done' })] })
		});

		expect(result.conflicts).toEqual([]);
	});
});
