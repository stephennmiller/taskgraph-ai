/**
 * removeTask only touches the tag it removes from. A dependency ID names a task
 * of the same tag, so another tag's task 1 is not the one that was removed.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { vi } from 'vitest';

// Real file I/O from utils; only logging is silenced
vi.doMock('../../../../../scripts/modules/utils.js', async () => {
	const actual = await vi.importActual(
		'../../../../../scripts/modules/utils.js'
	);
	return { ...actual, log: vi.fn(), isSilentMode: vi.fn(() => true) };
});

const { default: removeTask } = await import(
	'../../../../../scripts/modules/task-manager/remove-task.js'
);

const task = (id, dependencies = []) => ({
	id,
	title: `Task ${id}`,
	status: 'pending',
	dependencies,
	subtasks: []
});

describe('removeTask with several tags', () => {
	let dir;
	let tasksPath;

	const readFile = () => JSON.parse(fs.readFileSync(tasksPath, 'utf8'));

	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-remove-'));
		tasksPath = path.join(dir, 'tasks.json');
		fs.writeFileSync(
			tasksPath,
			JSON.stringify({
				master: {
					tasks: [task(1), task(2, [1])],
					metadata: {}
				},
				feature: {
					tasks: [task(1), task(7, [1])],
					metadata: {}
				}
			})
		);
	});

	afterEach(() => {
		fs.rmSync(dir, { recursive: true, force: true });
	});

	test('keeps the dependencies other tags have on their own task with that ID', async () => {
		const result = await removeTask(tasksPath, '1', {
			projectRoot: dir,
			tag: 'master'
		});

		expect(result.success).toBe(true);
		const saved = readFile();
		expect(saved.master.tasks.map((t) => t.id)).toEqual(['2']);
		expect(saved.master.tasks[0].dependencies).toEqual([]);
		expect(saved.feature.tasks.map((t) => t.id)).toEqual(['1', '7']);
		expect(saved.feature.tasks[1].dependencies).toEqual(['1']);
	});

	test('removes from a file saved with string IDs, as tm-core saves them (#392)', async () => {
		const current = readFile();
		current.master.tasks = [task('1', []), task('2', ['1'])];
		current.master.tasks[1].subtasks = [
			{ id: 1, title: 'Sub', dependencies: [] }
		];
		fs.writeFileSync(tasksPath, JSON.stringify(current));

		const result = await removeTask(tasksPath, '1,2.1', {
			projectRoot: dir,
			tag: 'master'
		});

		expect(result.error).toBeNull();
		expect(readFile().master.tasks).toMatchObject([
			{ id: '2', dependencies: [], subtasks: [] }
		]);
	});

	test('removes from the file as it is, not as it was read', async () => {
		const original = fs.readFileSync;
		let changed = false;
		// Another process adds task 3 right after removeTask reads the file
		vi.spyOn(fs, 'readFileSync').mockImplementation((...args) => {
			const content = original.apply(fs, args);
			if (!changed && String(args[0]) === tasksPath) {
				changed = true;
				const current = JSON.parse(content);
				current.master.tasks.push(task(3));
				fs.writeFileSync(tasksPath, JSON.stringify(current));
			}
			return content;
		});

		await removeTask(tasksPath, '1', { projectRoot: dir, tag: 'master' });
		vi.restoreAllMocks();

		expect(readFile().master.tasks.map((t) => t.id)).toEqual(['2', '3']);
	});
});
