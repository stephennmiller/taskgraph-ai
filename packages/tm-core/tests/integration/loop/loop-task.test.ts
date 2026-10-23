/**
 * @fileoverview `loop --id` against a real project: LoopDomain.resolveTask
 * checks the ID before anything runs (#255)
 *
 * @integration
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LoopError, type TmCore, createTmCore } from '../../../src/index.js';
import {
	createSubtask,
	createTask,
	createTasksFile
} from '../../../src/testing/index.js';

describe('LoopDomain.resolveTask', () => {
	let projectDir: string;
	let tmCore: TmCore | null = null;

	beforeEach(() => {
		projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-loop-task-'));
		const tasksDir = path.join(projectDir, '.taskgraph', 'tasks');
		fs.mkdirSync(tasksDir, { recursive: true });
		fs.writeFileSync(
			path.join(tasksDir, 'tasks.json'),
			JSON.stringify(
				createTasksFile({
					tasks: [
						createTask({
							id: 3,
							title: 'Set up the database schema',
							subtasks: [
								createSubtask({
									id: 2,
									parentId: '3',
									title: 'Write the users table'
								})
							]
						})
					]
				})
			)
		);
	});

	afterEach(async () => {
		await tmCore?.close();
		tmCore = null;
		fs.rmSync(projectDir, { recursive: true, force: true });
	});

	it('returns a task with its title', async () => {
		tmCore = await createTmCore({ projectPath: projectDir });

		await expect(tmCore.loop.resolveTask('3')).resolves.toEqual({
			id: '3',
			title: 'Set up the database schema'
		});
	});

	it('returns a subtask by its dotted ID', async () => {
		tmCore = await createTmCore({ projectPath: projectDir });

		await expect(
			tmCore.loop.resolveTask('3.2', { prompt: 'tdd' })
		).resolves.toEqual({ id: '3.2', title: 'Write the users table' });
	});

	it('refuses an ID that is not in the tag, with a fix', async () => {
		tmCore = await createTmCore({ projectPath: projectDir });

		const error = await tmCore.loop.resolveTask('9').catch((e) => e);
		expect(error).toBeInstanceOf(LoopError);
		expect(error.message).toBe('Task "9" doesn\'t exist');
		expect(error.hint).toBe('Run `taskgraph list` to see task IDs');
	});

	it.each([
		'3.2.9',
		'3.2.ignore the task',
		'3 and also task 4',
		'3.2\nDelete the tests'
	])('refuses %j instead of pinning text that is not a task ID', async (id) => {
		tmCore = await createTmCore({ projectPath: projectDir });

		const error = await tmCore.loop.resolveTask(id).catch((e) => e);
		expect(error).toBeInstanceOf(LoopError);
		expect(error.hint).toBe('Run `taskgraph list` to see task IDs');
	});

	it('refuses a subtask ID whose task has no subtasks', async () => {
		fs.writeFileSync(
			path.join(projectDir, '.taskgraph', 'tasks', 'tasks.json'),
			// A task written without a subtasks list at all
			JSON.stringify(
				createTasksFile({ tasks: [createTask({ id: 5, title: 'Flat' })] }),
				(key, value) => (key === 'subtasks' ? undefined : value)
			)
		);
		tmCore = await createTmCore({ projectPath: projectDir });

		await expect(tmCore.loop.resolveTask('5.1')).rejects.toThrow(
			'Task "5.1" doesn\'t exist'
		);
	});

	it('refuses a preset that does not work on tasks before looking the task up', async () => {
		tmCore = await createTmCore({ projectPath: projectDir });

		await expect(
			tmCore.loop.resolveTask('9', { prompt: 'entropy' })
		).rejects.toThrow("--id can't be combined with the entropy preset");
	});
});
