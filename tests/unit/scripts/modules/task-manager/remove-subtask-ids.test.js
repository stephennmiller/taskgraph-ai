/**
 * removeSubtask with a list of IDs checks them all before removing any, and
 * saves once (#483). Real files in a temp dir; only logging is silenced.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { vi } from 'vitest';
import removeSubtask from '../../../../../scripts/modules/task-manager/remove-subtask.js';

vi.mock('../../../../../scripts/modules/utils.js', async (importOriginal) => ({
	...(await importOriginal()),
	log: vi.fn(),
	isSilentMode: vi.fn(() => true)
}));

const sub = (id) => ({
	id,
	title: `Sub ${id}`,
	description: `Sub ${id}`,
	status: 'pending',
	dependencies: []
});

describe('removeSubtask with several IDs', () => {
	let dir;
	let tasksPath;
	const context = () => ({ projectRoot: dir, tag: 'master' });
	const readTasks = () =>
		JSON.parse(fs.readFileSync(tasksPath, 'utf8')).master.tasks;

	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-remove-subtask-'));
		fs.mkdirSync(path.join(dir, '.taskgraph', 'tasks'), { recursive: true });
		tasksPath = path.join(dir, '.taskgraph', 'tasks', 'tasks.json');
		fs.writeFileSync(
			tasksPath,
			JSON.stringify({
				master: {
					tasks: [
						{
							id: 1,
							title: 'Task 1',
							description: 'Task 1',
							status: 'pending',
							dependencies: [],
							subtasks: [sub(1), sub(2)]
						}
					],
					metadata: {}
				}
			})
		);
	});

	afterEach(() => {
		fs.rmSync(dir, { recursive: true, force: true });
	});

	test.each([
		['a missing task', '9.9', "Task 9 not found, so subtask 9.9 doesn't exist"],
		['a missing subtask', '1.7', 'Subtask 1.7 not found']
	])(
		'changes nothing and names the ID when one is %s',
		async (_, missing, message) => {
			const before = fs.readFileSync(tasksPath, 'utf8');

			await expect(
				removeSubtask(tasksPath, ['1.1', missing], false, false, context())
			).rejects.toThrow(message);

			expect(fs.readFileSync(tasksPath, 'utf8')).toBe(before);
		}
	);

	test('changes nothing when the same ID is listed twice', async () => {
		const before = fs.readFileSync(tasksPath, 'utf8');

		await expect(
			removeSubtask(tasksPath, ['1.1', '1.1'], false, false, context())
		).rejects.toThrow('Subtask 1.1 not found');

		expect(fs.readFileSync(tasksPath, 'utf8')).toBe(before);
	});

	test('removes every listed subtask', async () => {
		const result = await removeSubtask(
			tasksPath,
			['1.1', '1.2'],
			false,
			false,
			context()
		);

		expect(result).toEqual([null, null]);
		expect(readTasks()[0].subtasks).toBeUndefined();
	});

	test('converts every listed subtask to its own task', async () => {
		const result = await removeSubtask(
			tasksPath,
			['1.1', '1.2'],
			true,
			false,
			context()
		);

		expect(result.map((t) => String(t.id))).toEqual(['2', '3']);
		expect(readTasks().map((t) => String(t.id))).toEqual(['1', '2', '3']);
	});
});
