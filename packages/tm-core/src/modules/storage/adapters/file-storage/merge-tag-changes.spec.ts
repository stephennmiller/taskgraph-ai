import { describe, expect, it } from 'vitest';
import { mergeTagChanges } from './merge-tag-changes.js';

interface TestTask {
	id: number | string;
	title: string;
	status: string;
	dependencies: unknown[];
	subtasks: unknown[];
	[field: string]: unknown;
}

const task = (
	id: number | string,
	fields: Record<string, unknown> = {}
): TestTask => ({
	id,
	title: `Task ${id}`,
	status: 'pending',
	dependencies: [],
	subtasks: [],
	...fields
});

const tag = (tasks: TestTask[], metadata: Record<string, unknown> = {}) => ({
	tasks,
	metadata: { created: '2026-01-01', ...metadata }
});

describe('mergeTagChanges', () => {
	it('saves the command as-is when nothing else changed', () => {
		const base = tag([task(1), task(2)]);
		const mine = tag([task(1, { title: 'New' }), task(2)]);

		const { merged, renumbered } = mergeTagChanges(base, mine, base);

		expect(merged).toEqual(mine);
		expect(renumbered).toEqual([]);
	});

	it('keeps a status change and a new task made while the command ran', () => {
		const base = tag([task(1), task(2)]);
		const mine = tag([task(1, { title: 'Use postgres' }), task(2)]);
		const theirs = tag([task(1), task(2, { status: 'done' }), task(3)]);

		const { merged } = mergeTagChanges(base, mine, theirs);

		expect(merged.tasks).toEqual([
			task(1, { title: 'Use postgres' }),
			task(2, { status: 'done' }),
			task(3)
		]);
	});

	it('keeps a status change on the very task the command updated', () => {
		const base = tag([task(1)]);
		const mine = tag([task(1, { title: 'New', details: 'More' })]);
		const theirs = tag([task(1, { status: 'in-progress' })]);

		const { merged } = mergeTagChanges(base, mine, theirs);

		expect(merged.tasks).toEqual([
			task(1, { title: 'New', details: 'More', status: 'in-progress' })
		]);
	});

	it("takes the command's value when both changed the same field", () => {
		const base = tag([task(1)]);
		const mine = tag([task(1, { title: 'Mine' })]);
		const theirs = tag([task(1, { title: 'Theirs' })]);

		const { merged } = mergeTagChanges(base, mine, theirs);

		expect(merged.tasks[0]).toMatchObject({ title: 'Mine' });
	});

	it('matches tasks by ID whether it is saved as a number or a string', () => {
		const base = tag([task(1), task(2)]);
		const mine = tag([task(1, { title: 'New' }), task(2)]);
		// tm-core saves task IDs as strings
		const theirs = tag([task('1'), task('2', { status: 'done' })]);

		const { merged } = mergeTagChanges(base, mine, theirs);

		expect(merged.tasks).toEqual([
			task('1', { title: 'New' }),
			task('2', { status: 'done' })
		]);
	});

	it('merges subtasks one by one', () => {
		const sub = (id: number, fields: Record<string, unknown> = {}) => ({
			id,
			title: `Sub ${id}`,
			status: 'pending',
			...fields
		});
		const base = tag([task(1, { subtasks: [sub(1), sub(2)] })]);
		const mine = tag([
			task(1, { subtasks: [sub(1, { details: 'Note' }), sub(2)] })
		]);
		const theirs = tag([
			task(1, { subtasks: [sub(1), sub(2, { status: 'done' })] })
		]);

		const { merged } = mergeTagChanges(base, mine, theirs);

		expect(merged.tasks[0].subtasks).toEqual([
			sub(1, { details: 'Note' }),
			sub(2, { status: 'done' })
		]);
	});

	it('removes what the command removed and keeps what others removed gone', () => {
		const base = tag([task(1), task(2), task(3)]);
		const mine = tag([task(1), task(3, { title: 'Changed' })]);
		const theirs = tag([task(1), task(2)]);

		const { merged } = mergeTagChanges(base, mine, theirs);

		expect(merged.tasks).toEqual([task(1)]);
	});

	it('appends tasks the command added after tasks others added', () => {
		const base = tag([task(1)]);
		const mine = tag([task(1), task(2, { title: 'Mine' })]);
		const theirs = tag([task(1), task(3, { title: 'Theirs' })]);

		const { merged, renumbered } = mergeTagChanges(base, mine, theirs);

		expect(merged.tasks.map((t) => [t.id, t.title])).toEqual([
			[1, 'Task 1'],
			[3, 'Theirs'],
			[2, 'Mine']
		]);
		expect(renumbered).toEqual([]);
	});

	it('gives an added task the next free ID when someone else took its ID', () => {
		const base = tag([task(1)]);
		const mine = tag([
			task(1),
			task(2, { title: 'Mine' }),
			task(3, { title: 'Mine too', dependencies: [2] })
		]);
		const theirs = tag([task(1), task(2, { title: 'Theirs' })]);

		const { merged, renumbered } = mergeTagChanges(base, mine, theirs);

		expect(merged.tasks.map((t) => [t.id, t.title, t.dependencies])).toEqual([
			[1, 'Task 1', []],
			[2, 'Theirs', []],
			[4, 'Mine', []],
			[3, 'Mine too', [4]]
		]);
		expect(renumbered).toEqual([{ from: '2', to: '4' }]);
	});

	it('reports a renumbered subtask with its parent ID', () => {
		const sub = (id: number, title: string) => ({ id, title });
		const base = tag([task(5, { subtasks: [sub(1, 'a')] })]);
		const mine = tag([task(5, { subtasks: [sub(1, 'a'), sub(2, 'mine')] })]);
		const theirs = tag([
			task(5, { subtasks: [sub(1, 'a'), sub(2, 'theirs')] })
		]);

		const { merged, renumbered } = mergeTagChanges(base, mine, theirs);

		expect(merged.tasks[0].subtasks).toEqual([
			sub(1, 'a'),
			sub(2, 'theirs'),
			sub(3, 'mine')
		]);
		expect(renumbered).toEqual([{ from: '5.2', to: '5.3' }]);
	});

	it('does not add a task twice when both sides added the same one', () => {
		const base = tag([task(1)]);
		const mine = tag([task(1), task(2)]);
		const theirs = tag([task(1), task(2)]);

		const { merged } = mergeTagChanges(base, mine, theirs);

		expect(merged.tasks).toEqual([task(1), task(2)]);
	});

	it('keeps fields others added and merges tag metadata by field', () => {
		const base = tag([task(1)], { updated: 'a' });
		const mine = tag([task(1)], { updated: 'b' });
		const theirs = tag([task(1, { parentId: '1' })], {
			updated: 'a',
			lastModified: 'c'
		});

		const { merged } = mergeTagChanges(base, mine, theirs);

		expect(merged.tasks).toEqual([task(1, { parentId: '1' })]);
		expect(merged.metadata).toEqual({
			created: '2026-01-01',
			updated: 'b',
			lastModified: 'c'
		});
	});

	it('points subtask dependencies and their provenance at a renumbered sibling', () => {
		const sub = (id: number, fields: Record<string, unknown> = {}) => ({
			id,
			title: `Sub ${id}`,
			dependencies: [] as unknown[],
			...fields
		});
		const base = tag([task(5, { subtasks: [sub(1)] })]);
		const mine = tag([
			task(5, {
				subtasks: [
					sub(1),
					sub(2, { title: 'mine' }),
					sub(3, {
						dependencies: [2, '5.2', 1],
						metadata: { dependencySources: { '5.2': 'inferred' } }
					})
				]
			})
		]);
		const theirs = tag([
			task(5, { subtasks: [sub(1), sub(2, { title: 'theirs' })] })
		]);

		const { merged, renumbered } = mergeTagChanges(base, mine, theirs);

		expect(renumbered).toEqual([{ from: '5.2', to: '5.4' }]);
		const subtasks = merged.tasks[0].subtasks as Record<string, unknown>[];
		expect(subtasks.map((s) => s.id)).toEqual([1, 2, 4, 3]);
		expect(subtasks[3]).toMatchObject({
			dependencies: [4, '5.4', 1],
			metadata: { dependencySources: { '5.4': 'inferred' } }
		});
	});

	it("moves a renumbered task's dotted subtask dependencies with it", () => {
		const base = tag([task(1)]);
		const mine = tag([
			task(1),
			task(2, {
				title: 'Mine',
				subtasks: [
					{ id: 1, title: 'a', dependencies: [] },
					{ id: 2, title: 'b', dependencies: ['2.1', 1, '1'] }
				]
			})
		]);
		const theirs = tag([task(1), task(2, { title: 'Theirs' })]);

		const { merged } = mergeTagChanges(base, mine, theirs);

		const moved = merged.tasks[2];
		expect(moved.id).toBe(3);
		expect(
			(moved.subtasks[1] as { dependencies: unknown[] }).dependencies
		).toEqual(['3.1', 1, '1']);
	});

	it("moves a renumbered task's related links to its subtasks with it", () => {
		const base = tag([task(1)]);
		const mine = tag([
			task(1),
			task(2, {
				title: 'Mine',
				subtasks: [
					{ id: 1, title: 'a', dependencies: [] },
					{
						id: 2,
						title: 'b',
						dependencies: [],
						metadata: { taskLinks: { '2.1': 'related', '1': 'related' } }
					}
				]
			})
		]);
		const theirs = tag([task(1), task(2, { title: 'Theirs' })]);

		const { merged } = mergeTagChanges(base, mine, theirs);

		expect(
			(merged.tasks[2].subtasks[1] as { metadata: unknown }).metadata
		).toEqual({ taskLinks: { '3.1': 'related', '1': 'related' } });
	});

	it("keeps the command's new order and others' additions next to their neighbour", () => {
		const base = tag([task(1), task(2), task(3)]);
		const mine = tag([task(3), task(1), task(2)]);
		const theirs = tag([
			task(1),
			task(4),
			task(2, { status: 'done' }),
			task(3)
		]);

		const { merged } = mergeTagChanges(base, mine, theirs);

		expect(merged.tasks.map((t) => t.id)).toEqual([3, 1, 4, 2]);
		expect(merged.tasks[3].status).toBe('done');
	});

	it('keeps __proto__ and constructor keys as plain data', () => {
		const base = JSON.parse(
			'{"tasks":[{"id":1,"title":"a","__proto__":{"x":1}}],"metadata":{}}'
		);
		const mine = JSON.parse(
			'{"tasks":[{"id":1,"title":"b","__proto__":{"x":1},"constructor":"c"}],"metadata":{}}'
		);
		const theirs = JSON.parse(
			'{"tasks":[{"id":1,"title":"a","__proto__":{"x":2}}],"metadata":{"m":1}}'
		);

		const { merged } = mergeTagChanges(base, mine, theirs);

		const saved = JSON.parse(JSON.stringify(merged));
		expect(Object.getPrototypeOf(merged.tasks[0])).toBe(Object.prototype);
		expect(Object.hasOwn(saved.tasks[0], '__proto__')).toBe(true);
		expect(saved.tasks[0].__proto__).toEqual({ x: 2 });
		expect(saved.tasks[0].constructor).toBe('c');
		expect(saved.tasks[0].title).toBe('b');
		expect(({} as Record<string, unknown>).x).toBeUndefined();
	});

	it('keeps a criterion checked meanwhile when the command kept the checklist', () => {
		const criteria = ['Schema migrated', 'Docs'];
		const base = tag([task(5, { acceptanceCriteria: criteria })]);
		// AI rewrites copy the checklist fields from the task as read
		const mine = tag([
			task(5, { title: 'Use postgres', acceptanceCriteria: criteria })
		]);
		const theirs = tag([
			task(5, {
				acceptanceCriteria: [
					{ text: 'Schema migrated', checked: true },
					{ text: 'Docs', checked: false }
				],
				definitionOfDoneChecked: ['Tests pass']
			})
		]);

		const { merged } = mergeTagChanges(base, mine, theirs);

		expect(merged.tasks[0]).toMatchObject({
			title: 'Use postgres',
			acceptanceCriteria: [
				{ text: 'Schema migrated', checked: true },
				{ text: 'Docs', checked: false }
			],
			definitionOfDoneChecked: ['Tests pass']
		});
	});
});
