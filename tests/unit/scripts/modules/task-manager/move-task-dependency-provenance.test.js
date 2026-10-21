/**
 * Moving tasks and subtasks keeps their metadata and the inferred marks on
 * the dependencies that point at them. Only tasks.json I/O is mocked.
 */
import { vi } from 'vitest';

const { readJSON, writeJSON } = vi.hoisted(() => ({
	readJSON: vi.fn(),
	writeJSON: vi.fn()
}));

vi.mock('../../../../../scripts/modules/utils.js', async (importOriginal) => ({
	...(await importOriginal()),
	readJSON,
	writeJSON,
	log: vi.fn()
}));

import moveTask from '../../../../../scripts/modules/task-manager/move-task.js';

const inferred = (value) => ({ dependencySources: value });

const tagged = () => ({
	master: {
		tasks: [
			{ id: 1, title: 'A', dependencies: [] },
			{
				id: 2,
				title: 'B',
				dependencies: [1],
				metadata: inferred({ 1: 'inferred' }),
				subtasks: [
					{
						id: 1,
						title: 'B.1',
						// the string "1" is task 1; a bare 1 would be sibling 2.1
						dependencies: ['1'],
						metadata: inferred({ 1: 'inferred' })
					},
					{
						id: 2,
						title: 'B.2',
						dependencies: [1],
						metadata: { owner: 'kim', ...inferred({ 2.1: 'inferred' }) }
					}
				]
			},
			{
				id: 3,
				title: 'C',
				dependencies: [5, 7],
				metadata: inferred({ 5: 'inferred' })
			},
			{ id: 7, title: 'G', dependencies: [] },
			{
				id: 8,
				title: 'H',
				dependencies: [],
				subtasks: [
					{
						id: 1,
						title: 'H.1',
						dependencies: [],
						metadata: { owner: 'lee' }
					},
					{
						id: 2,
						title: 'H.2',
						dependencies: ['8.1', 1],
						metadata: inferred({ 8.1: 'inferred' })
					}
				]
			},
			{
				id: 11,
				title: 'K',
				// 3 and 8.2 are what the moves below turn into new IDs
				dependencies: [3, '8.2'],
				metadata: inferred({ 3: 'inferred' }),
				subtasks: [
					{
						id: 1,
						title: 'K.1',
						dependencies: ['3'],
						metadata: inferred({ 3: 'inferred' })
					},
					{ id: 2, title: 'K.2', dependencies: ['8.2'] }
				]
			}
		],
		metadata: {}
	}
});

/** Run a move and return the tasks it wrote */
async function move(from, to) {
	readJSON.mockImplementation((path, projectRoot, tag) => {
		const data = tagged();
		return { ...data[tag], tag, _rawTaggedData: data };
	});
	await moveTask('tasks.json', from, to, false, { tag: 'master' });
	return writeJSON.mock.calls[0][1].master.tasks;
}

describe('moveTask dependency provenance', () => {
	beforeEach(() => writeJSON.mockClear());

	test('carries the inferred mark to the new ID of a dependency', async () => {
		const written = await move('1', '4');

		const dependent = written.find((t) => t.id === 2);
		expect(dependent.dependencies).toEqual([4]);
		expect(dependent.metadata.dependencySources).toEqual({ 4: 'inferred' });
		expect(dependent.subtasks[0].dependencies).toEqual(['4']);
		expect(dependent.subtasks[0].metadata.dependencySources).toEqual({
			4: 'inferred'
		});
	});

	test('leaves a sibling reference with the old task number alone, and rewrites the string', async () => {
		// 2.2 lists 1 (sibling 2.1) and 2.1 lists "1" (task 1); task 1 moves to 4
		const written = await move('1', '4');

		const parent = written.find((t) => t.id === 2);
		expect(parent.subtasks[1].dependencies).toEqual([1]);
		expect(parent.subtasks[0].dependencies).toEqual(['4']);
	});

	test('the new ID takes the old ID source, replacing a mark it already had', async () => {
		// task 3 lists 5 (inferred) and 7 (explicit); 7 becomes 5
		const written = await move('7', '5');

		const dependent = written.find((t) => t.id === 3);
		expect(dependent.dependencies).toEqual([5, 5]);
		expect(dependent.metadata).toBeUndefined();
	});

	test('re-keys the sibling marks of a moved task under its new ID', async () => {
		const written = await move('8', '9');

		const moved = written.find((t) => t.id === 9);
		expect(moved.subtasks[1].dependencies).toEqual(['9.1', 1]);
		expect(moved.subtasks[1].metadata.dependencySources).toEqual({
			9.1: 'inferred'
		});
		expect(moved.subtasks[0].metadata).toEqual({ owner: 'lee' });
	});

	test('keeps metadata and re-keys marks when a subtask becomes a task', async () => {
		const written = await move('2.2', '10');

		const converted = written.find((t) => t.id === 10);
		expect(converted.metadata.owner).toBe('kim');
		// 2.2 listed sibling 2.1 as 1; on a task it must say which task's subtask
		expect(converted.dependencies).toEqual(['2.1']);
		expect(converted.metadata.dependencySources).toEqual({
			2.1: 'inferred'
		});
	});

	test('repoints what depended on a subtask that becomes a task', async () => {
		const written = await move('8.2', '12');

		const dependent = written.find((t) => t.id === 11);
		expect(dependent.dependencies).toEqual([3, 12]);
		expect(dependent.subtasks[1].dependencies).toEqual(['12']);
	});

	test('keeps metadata and re-keys marks when a task becomes a subtask', async () => {
		const written = await move('2', '3.4');

		const subtask = written
			.find((t) => t.id === 3)
			.subtasks.find((st) => st.id === 4);
		// Task 2 listed task 1; as a subtask it must keep saying task 1, not sibling 3.1
		expect(subtask.dependencies).toEqual(['1']);
		expect(subtask.metadata.dependencySources).toEqual({ 1: 'inferred' });
	});

	test('repoints what depended on a task that becomes a subtask', async () => {
		const written = await move('3', '8.3');

		const dependent = written.find((t) => t.id === 11);
		expect(dependent.dependencies).toEqual(['8.3', '8.2']);
		expect(dependent.metadata.dependencySources).toEqual({
			8.3: 'inferred'
		});
		expect(dependent.subtasks[0].dependencies).toEqual(['8.3']);
		expect(dependent.subtasks[0].metadata.dependencySources).toEqual({
			8.3: 'inferred'
		});
	});

	test('drops the new parent from the dependencies of a task that becomes its subtask', async () => {
		// task 3 lists 5 and 7; 7 becomes the parent
		const written = await move('3', '7.1');

		const subtask = written.find((t) => t.id === 7).subtasks[0];
		expect(subtask.dependencies).toEqual(['5']);
		expect(subtask.metadata.dependencySources).toEqual({ 5: 'inferred' });
	});

	test('keeps metadata when a subtask moves to another parent', async () => {
		const written = await move('2.2', '8.3');

		const subtask = written
			.find((t) => t.id === 8)
			.subtasks.find((st) => st.id === 3);
		expect(subtask.metadata.owner).toBe('kim');
		// Still depends on its old sibling 2.1, not on 8.1
		expect(subtask.dependencies).toEqual(['2.1']);
		expect(subtask.metadata.dependencySources).toEqual({
			2.1: 'inferred'
		});
	});

	test('repoints what depended on a subtask that moves to another parent', async () => {
		const written = await move('8.2', '2.5');

		const dependent = written.find((t) => t.id === 11);
		expect(dependent.dependencies).toEqual([3, '2.5']);
		expect(dependent.subtasks[1].dependencies).toEqual(['2.5']);
	});
});
