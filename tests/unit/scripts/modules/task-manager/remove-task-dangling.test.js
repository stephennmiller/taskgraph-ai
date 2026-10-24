/**
 * removeTask counts the tasks left depending on a missing task, so the CLI
 * and MCP can point to fix-dependencies, and leaves those dependencies as
 * they are (#517).
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

const { removeTaskDirect } = await import(
	'../../../../../mcp-server/src/core/direct-functions/remove-task.js'
);

const task = (id, dependencies = [], subtasks = []) => ({
	id,
	title: `Task ${id}`,
	status: 'pending',
	dependencies,
	subtasks
});

describe('removeTask and dependencies on missing tasks', () => {
	let dir;
	let tasksPath;

	const write = (tasks) =>
		fs.writeFileSync(
			tasksPath,
			JSON.stringify({ master: { tasks, metadata: {} } })
		);
	const saved = () =>
		JSON.parse(fs.readFileSync(tasksPath, 'utf8')).master.tasks;

	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-remove-dangling-'));
		tasksPath = path.join(dir, 'tasks.json');
	});

	afterEach(() => {
		fs.rmSync(dir, { recursive: true, force: true });
	});

	test('counts dependencies that were missing before, and keeps them', async () => {
		write([
			task('1'),
			task('2', ['1']),
			task('3', ['9']),
			task('4', [], [{ id: 1, title: 'Sub', dependencies: ['8'] }])
		]);

		const result = await removeTask(tasksPath, '1', {
			projectRoot: dir,
			tag: 'master'
		});

		expect(result.success).toBe(true);
		expect(result.danglingDependents).toBe(2);
		const tasks = saved();
		expect(tasks.map((t) => t.dependencies)).toEqual([[], ['9'], []]);
		expect(tasks[2].subtasks[0].dependencies).toEqual(['8']);
	});

	test('counts nothing when the only references were to the removed task', async () => {
		write([
			task('1'),
			task('2', ['1'], [{ id: 1, title: 'Sub', dependencies: ['1'] }])
		]);

		const result = await removeTask(tasksPath, '1', {
			projectRoot: dir,
			tag: 'master'
		});

		expect(result.success).toBe(true);
		expect(result.danglingDependents).toBe(0);
	});

	test('counts nothing when the remaining dependencies all exist', async () => {
		write([
			task('1'),
			task('2', ['3.2']),
			task(
				'3',
				[],
				[
					{ id: 1, title: 'Sub', dependencies: [] },
					{ id: 2, title: 'Sub', dependencies: [1, '2'] }
				]
			)
		]);

		const result = await removeTask(tasksPath, '1', {
			projectRoot: dir,
			tag: 'master'
		});

		expect(result.danglingDependents).toBe(0);
	});

	test('MCP remove_task replies with the fix-dependencies hint', async () => {
		write([task('1'), task('3', ['9'])]);
		const log = { info: vi.fn(), error: vi.fn() };

		const result = await removeTaskDirect(
			{ tasksJsonPath: tasksPath, id: '1', projectRoot: dir, tag: 'master' },
			log
		);

		expect(result.data.hint).toBe(
			'1 task depends on missing tasks. Run: taskgraph fix-dependencies --tag master'
		);
	});
});
