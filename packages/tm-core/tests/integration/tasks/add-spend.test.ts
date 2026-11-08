/**
 * @fileoverview tasks.addSpend against a real tasks.json: each loop
 * iteration's cost and time add up on the task, across runs.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '../../../src/common/errors/taskgraph-error.js';
import { FileStorage } from '../../../src/modules/storage/adapters/file-storage/file-storage.js';
import {
	createSubtask,
	createTask
} from '../../../src/testing/task-fixtures.js';
import { type TmCore, createTmCore } from '../../../src/tm-core.js';
import { seedTasks } from '../seed-tasks.js';

describe('tasks.addSpend', () => {
	let projectDir: string;
	let tmCore: TmCore;

	const stored = async (id: string) =>
		(await new FileStorage(projectDir).loadTasks('master')).find(
			(t) => t.id === id
		);

	beforeEach(async () => {
		projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-add-spend-'));
		const tgDir = path.join(projectDir, '.taskgraph');
		fs.mkdirSync(path.join(tgDir, 'tasks'), { recursive: true });
		fs.writeFileSync(
			path.join(tgDir, 'config.json'),
			JSON.stringify({ models: {}, global: {} })
		);
		await seedTasks(
			new FileStorage(projectDir),
			[
				createTask({
					id: '1',
					title: 'Build the login API',
					subtasks: [
						createSubtask({ id: 1, parentId: '1', title: 'Hash passwords' })
					]
				}),
				{
					...createTask({ id: '2', title: 'Add the sign-up form' }),
					spend: { usd: 'lots', durationMs: -5, iterations: 2 } as never
				}
			],
			'master'
		);
		tmCore = await createTmCore({ projectPath: projectDir });
	});

	afterEach(async () => {
		await tmCore?.close();
		fs.rmSync(projectDir, { recursive: true, force: true });
	});

	it('adds up each run on the task, and a subtask run on its parent', async () => {
		await tmCore.tasks.addSpend('1', { usd: 0.5, durationMs: 1000 });
		// A run that reported no cost still counts its time and iteration
		await tmCore.tasks.addSpend('1.1', { durationMs: 500 });
		const saved = await tmCore.tasks.addSpend('1', {
			usd: 0.25,
			durationMs: 250
		});

		const expected = { usd: 0.75, durationMs: 1750, iterations: 3 };
		expect(saved).toEqual(expected);
		const task = await stored('1');
		expect(task?.spend).toEqual(expected);
		expect(task?.subtasks[0]).not.toHaveProperty('spend');
		// show --json returns the task as stored
		expect((await tmCore.tasks.get('1')).task?.spend).toEqual(expected);
	});

	it('counts a hand-edited value it cannot read as 0', async () => {
		await tmCore.tasks.addSpend('2', { usd: 1, durationMs: 10 });

		expect((await stored('2'))?.spend).toEqual({
			usd: 1,
			durationMs: 10,
			iterations: 3
		});
	});

	it('throws TASK_NOT_FOUND for an unknown task', async () => {
		await expect(
			tmCore.tasks.addSpend('9', { usd: 1, durationMs: 1 })
		).rejects.toMatchObject({ code: ERROR_CODES.TASK_NOT_FOUND });
	});
});
