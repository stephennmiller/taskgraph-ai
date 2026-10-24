/**
 * Related and discovered-from links (#200): add-task --discovered-from, and
 * the commands that must keep or clean them up (remove-task, move; the
 * dependency commands are tested in @tm/core's dependency-edit and
 * dependency-check specs). They
 * live in metadata.taskLinks, never in dependencies. Only tasks.json I/O is
 * mocked.
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

// The real helper edits the file under a lock; here it edits what the mocked
// readJSON returns and hands the result to writeJSON
vi.mock('../../../../../scripts/modules/utils/update-tag-tasks.js', () => ({
	updateTagTasks: async (filepath, tag, mutate) => {
		const view = readJSON(filepath, undefined, tag);
		const raw = view._rawTaggedData ?? { [tag]: view };
		const result = mutate(raw[tag]);
		writeJSON(filepath, raw);
		return result;
	}
}));

import addTask from '../../../../../scripts/modules/task-manager/add-task.js';
import moveTask, {
	moveTasksBetweenTags
} from '../../../../../scripts/modules/task-manager/move-task.js';
import removeSubtask from '../../../../../scripts/modules/task-manager/remove-subtask.js';
import removeTask from '../../../../../scripts/modules/task-manager/remove-task.js';

const context = { projectRoot: '/project', tag: 'master' };

const links = (value) => ({ taskLinks: value });

const tagged = () => ({
	master: {
		tasks: [
			{ id: 1, title: 'One', status: 'pending', dependencies: [] },
			{
				id: 2,
				title: 'Two',
				status: 'pending',
				dependencies: [1],
				metadata: { owner: 'kim' },
				subtasks: [
					{ id: 1, title: 'Two.1', status: 'pending', dependencies: [] },
					{
						id: 2,
						title: 'Two.2',
						status: 'pending',
						dependencies: [],
						metadata: links({ 2.1: 'related' })
					}
				]
			},
			{
				id: 3,
				title: 'Three',
				status: 'pending',
				dependencies: [],
				metadata: links({ 1: 'related', 2.2: 'discovered-from' })
			},
			{ id: 4, title: 'Four', status: 'pending', dependencies: [] }
		],
		metadata: {}
	},
	other: {
		tasks: [{ id: 1, title: 'Other one', status: 'pending', dependencies: [] }],
		metadata: {}
	}
});

let data;

beforeEach(() => {
	writeJSON.mockClear();
	data = tagged();
	readJSON.mockImplementation((path, projectRoot, tag = 'master') => {
		const copy = structuredClone(data);
		return { ...copy[tag], tag, _rawTaggedData: copy };
	});
});

/** Tasks of `tag` in the last write, whichever shape the command wrote */
const writtenTasks = (tag = 'master') => {
	const saved = writeJSON.mock.calls.at(-1)[1];
	return (saved[tag] ?? saved).tasks;
};
const find = (tasks, id) => tasks.find((t) => t.id === id);

describe('remove-task cleans up links like dependencies', () => {
	test('drops links to a removed task', async () => {
		await removeTask('tasks.json', '1', context);

		expect(find(writtenTasks(), 3).metadata).toEqual(
			links({ 2.2: 'discovered-from' })
		);
	});

	test("drops links to a removed task's subtasks", async () => {
		await removeTask('tasks.json', '2', context);

		expect(find(writtenTasks(), 3).metadata).toEqual(links({ 1: 'related' }));
	});

	test('remove-subtask drops links to the subtask', async () => {
		await removeSubtask('tasks.json', '2.2', false, false, context);

		expect(find(writtenTasks(), 3).metadata).toEqual(links({ 1: 'related' }));
	});
});

describe('move keeps links pointing at the moved task', () => {
	test('a task moved to a new ID, with its subtasks', async () => {
		await moveTask('tasks.json', '2', '7', false, context);

		const tasks = writtenTasks();
		expect(find(tasks, 3).metadata).toEqual(
			links({ 1: 'related', 7.2: 'discovered-from' })
		);
		// The moved task's own links, and its subtasks', follow it too
		expect(find(tasks, 7).subtasks[1].metadata).toEqual(
			links({ 7.1: 'related' })
		);
	});

	test('a subtask that becomes a task', async () => {
		await moveTask('tasks.json', '2.2', '9', false, context);

		const tasks = writtenTasks();
		expect(find(tasks, 3).metadata).toEqual(
			links({ 1: 'related', 9: 'discovered-from' })
		);
		expect(find(tasks, 9).metadata).toEqual(links({ 2.1: 'related' }));
	});

	test('a task moved to another tag keeps no links across tags', async () => {
		data.master.tasks[3].metadata = links({ 3: 'related' });

		await moveTasksBetweenTags(
			'tasks.json',
			['3'],
			'master',
			'other',
			{},
			context
		);

		const moved = find(writtenTasks('other'), 3);
		expect(moved.metadata.taskLinks).toBeUndefined();
		expect(find(writtenTasks('master'), 4).metadata).toBeUndefined();
	});
});

describe('add-task --discovered-from', () => {
	const manual = { title: 'Fix the flaky test', description: 'Found it' };

	test('stores a discovered-from link, not a dependency', async () => {
		await addTask(
			'tasks.json',
			null,
			[],
			'medium',
			context,
			'json',
			manual,
			false,
			{ discoveredFrom: '2.1' }
		);

		const added = find(writtenTasks(), 5);
		expect(added.dependencies).toEqual([]);
		expect(added.metadata).toEqual(links({ 2.1: 'discovered-from' }));
	});

	test('refuses a task that does not exist, before writing anything', async () => {
		await expect(
			addTask(
				'tasks.json',
				null,
				[],
				'medium',
				context,
				'json',
				manual,
				false,
				{ discoveredFrom: '42' }
			)
		).rejects.toMatchObject({
			message: "Task 42 doesn't exist",
			hint: 'Run `taskgraph list` to see task IDs'
		});
		expect(writeJSON).not.toHaveBeenCalled();
	});
});
