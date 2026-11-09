/**
 * @fileoverview tasks.get with a subtask status filter against a real
 * tasks.json: `show --status`, `show --json` and MCP get_task share it, so
 * each takes several statuses and refuses an unknown one (#1070)
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

describe('tasks.get with a subtask status', () => {
	let projectDir: string;
	let tmCore: TmCore;

	beforeEach(async () => {
		projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-get-status-'));
		const dir = path.join(projectDir, '.taskgraph');
		fs.mkdirSync(path.join(dir, 'tasks'), { recursive: true });
		fs.writeFileSync(
			path.join(dir, 'config.json'),
			JSON.stringify({ models: {}, global: {} })
		);
		await seedTasks(
			new FileStorage(projectDir),
			[
				createTask({
					id: 2,
					title: 'Build the login API',
					subtasks: [
						createSubtask({
							id: 1,
							parentId: '2',
							title: 'S1',
							status: 'done'
						}),
						createSubtask({
							id: 2,
							parentId: '2',
							title: 'S2',
							status: 'in-progress'
						}),
						createSubtask({
							id: 3,
							parentId: '2',
							title: 'S3',
							status: 'pending'
						})
					]
				})
			],
			'master'
		);
		tmCore = await createTmCore({ projectPath: projectDir });
	});

	afterEach(async () => {
		await tmCore?.close();
		fs.rmSync(projectDir, { recursive: true, force: true });
	});

	const subtaskIds = (task: { subtasks?: { id: unknown }[] } | null) =>
		task?.subtasks?.map((s) => String(s.id));

	it('keeps the subtasks with any of the statuses, and says how many there were', async () => {
		const result = await tmCore.tasks.get('2', undefined, {
			subtaskStatus: 'done, pending'
		});

		expect(subtaskIds(result.task)).toEqual(['1', '3']);
		expect(result).toMatchObject({
			subtaskFilter: { statuses: ['done', 'pending'], total: 3 }
		});
	});

	it('keeps every subtask for all or no status', async () => {
		for (const subtaskStatus of ['all', undefined]) {
			const result = await tmCore.tasks.get('2', undefined, { subtaskStatus });
			expect(subtaskIds(result.task)).toEqual(['1', '2', '3']);
			expect(result).not.toHaveProperty('subtaskFilter');
		}
	});

	it('refuses an unknown status, as list does', async () => {
		await expect(
			tmCore.tasks.get('2', undefined, { subtaskStatus: 'done,bogus' })
		).rejects.toThrow('"bogus" isn\'t a status');
	});
});
