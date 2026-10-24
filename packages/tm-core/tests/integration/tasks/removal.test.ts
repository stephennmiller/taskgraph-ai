/**
 * @fileoverview tasks.removeTasks / removeSubtasks / clearSubtasks against a
 * real tasks.json: what they write, that a refused change writes nothing,
 * the tag option, a tag that doesn't exist, task files and archived IDs.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type TmCore, createTmCore } from '../../../src/tm-core.js';

describe('tasks removal commands', () => {
	let projectDir: string;
	let tasksPath: string;
	let tmCore: TmCore;

	const task = (id: number, extra = {}) => ({
		id,
		title: `Task ${id}`,
		description: '',
		status: 'pending',
		priority: 'medium',
		dependencies: [],
		...extra
	});
	const sub = (id: number) => ({
		id,
		title: `Sub ${id}`,
		status: 'pending',
		dependencies: []
	});
	const write = (data: unknown) =>
		fs.writeFileSync(tasksPath, JSON.stringify(data, null, 2));
	const raw = () => fs.readFileSync(tasksPath, 'utf8');
	const read = () => JSON.parse(raw());

	beforeEach(async () => {
		projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-removal-'));
		const tgDir = path.join(projectDir, '.taskgraph');
		fs.mkdirSync(path.join(tgDir, 'tasks'), { recursive: true });
		fs.writeFileSync(
			path.join(tgDir, 'config.json'),
			JSON.stringify({ models: {}, global: {} })
		);
		tasksPath = path.join(tgDir, 'tasks', 'tasks.json');
		write({
			master: {
				tasks: [
					task(1),
					task(2, { dependencies: [1], subtasks: [sub(1), sub(2)] }),
					task(3, { dependencies: ['2.1'] })
				],
				metadata: {}
			},
			other: { tasks: [task(1, { subtasks: [sub(1)] })], metadata: {} }
		});
		tmCore = await createTmCore({ projectPath: projectDir });
	});

	afterEach(async () => {
		await tmCore?.close();
		fs.rmSync(projectDir, { recursive: true, force: true });
	});

	it('removes tasks with their task files, and what pointed at them', async () => {
		const taskFile = path.join(path.dirname(tasksPath), 'task_002.txt');
		fs.writeFileSync(taskFile, 'Task 2');

		const result = await tmCore.tasks.removeTasks('2');

		expect(result).toMatchObject({ tag: 'master', errors: [], tasksPath });
		expect(result.messages).toEqual([
			"Successfully removed task 2 from tag 'master'",
			`Deleted task file: ${taskFile}`
		]);
		expect(fs.existsSync(taskFile)).toBe(false);
		const tasks = read().master.tasks;
		expect(tasks.map((t: { id: unknown }) => String(t.id))).toEqual(['1', '3']);
		expect(tasks[1].dependencies).toEqual([]);
	});

	it('writes nothing when an ID is unknown', async () => {
		const before = raw();

		await expect(tmCore.tasks.removeTasks('1,9')).rejects.toThrow(
			"The following tasks were not found in tag 'master': 9"
		);
		await expect(tmCore.tasks.removeSubtasks(['2.1', '2.9'])).rejects.toThrow(
			'Subtask 2.9 not found'
		);
		await expect(tmCore.tasks.clearSubtasks('2,9')).rejects.toThrow(
			'Task 9 not found'
		);
		expect(raw()).toBe(before);
	});

	it('writes to the tag it is given, leaving the active tag alone', async () => {
		const before = read().master;

		const result = await tmCore.tasks.clearSubtasks('all', { tag: 'other' });

		expect(result).toMatchObject({
			tag: 'other',
			cleared: [{ id: 1, count: 1 }]
		});
		expect(read().other.tasks[0].subtasks).toEqual([]);
		expect(read().master).toEqual(before);
	});

	it('never creates a tag that does not exist', async () => {
		await expect(
			tmCore.tasks.removeSubtasks(['2.1'], { tag: 'ghost' })
		).rejects.toThrow('Tag "ghost" not found');
		await expect(
			tmCore.tasks.clearSubtasks('all', { tag: 'ghost' })
		).rejects.toThrow('Tag "ghost" not found');

		expect(Object.keys(read())).toEqual(['master', 'other']);
	});

	it('converts a subtask to a task above the archived IDs', async () => {
		fs.writeFileSync(
			path.join(path.dirname(tasksPath), 'archive.json'),
			JSON.stringify({
				master: {
					tasks: [{ ...task(7), status: 'done' }],
					metadata: { highestId: 7 }
				}
			})
		);

		const { converted } = await tmCore.tasks.removeSubtasks(['2.1'], {
			convert: true
		});

		expect(converted[0]).toMatchObject({ id: 8, dependencies: ['2'] });
		const tasks = read().master.tasks;
		// Storage saves top-level IDs as strings
		expect(tasks[2].dependencies).toEqual(['8']);
		expect(tasks[3]).toMatchObject({ id: '8', title: 'Sub 1' });
	});
});
