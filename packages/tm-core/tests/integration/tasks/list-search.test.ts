/**
 * @fileoverview tasks.list with a search filter against a real tasks.json:
 * a task with a matching subtask is kept even when subtasks are left out
 * of the reply (#986)
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileStorage } from '../../../src/modules/storage/adapters/file-storage/file-storage.js';
import {
	createSubtask,
	createTask
} from '../../../src/testing/task-fixtures.js';
import { type TmCore, createTmCore } from '../../../src/tm-core.js';
import { seedTasks } from '../seed-tasks.js';

describe('tasks.list with a search', () => {
	let projectDir: string;
	let tmCore: TmCore;

	beforeEach(async () => {
		projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-list-search-'));
		const dir = path.join(projectDir, '.taskgraph');
		fs.mkdirSync(path.join(dir, 'tasks'), { recursive: true });
		fs.writeFileSync(
			path.join(dir, 'config.json'),
			JSON.stringify({ models: {}, global: {} })
		);
		await seedTasks(
			new FileStorage(projectDir),
			[
				createTask({ id: 1, title: 'Build the login API', status: 'done' }),
				createTask({
					id: 2,
					title: 'Dashboard',
					testStrategy: 'Log in first',
					subtasks: [
						createSubtask({
							id: 1,
							parentId: '2',
							title: 'Add an OAuth button'
						})
					]
				}),
				createTask({ id: 3, title: 'Write the README' })
			],
			'master'
		);
		tmCore = await createTmCore({ projectPath: projectDir });
	});

	afterEach(async () => {
		await tmCore?.close();
		fs.rmSync(projectDir, { recursive: true, force: true });
	});

	it('keeps a task whose subtask matches, without returning its subtasks', async () => {
		const result = await tmCore.tasks.list({
			filter: { search: 'oauth' },
			includeSubtasks: false
		});

		expect(result.tasks.map((task) => task.id)).toEqual(['2']);
		expect(result.tasks[0].subtasks).toEqual([]);
		expect(result.total).toBe(3);
	});

	it('combines with the status filter', async () => {
		const result = await tmCore.tasks.list({
			filter: { status: ['pending'], search: 'LOG IN' }
		});

		expect(result.tasks.map((task) => task.id)).toEqual(['2']);
		expect(result.tasks[0].subtasks).toHaveLength(1);
	});
});
