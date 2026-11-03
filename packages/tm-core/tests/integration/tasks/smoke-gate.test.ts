/**
 * @fileoverview A loop run's `set-status done` runs `loop.smokeCommand`
 * first (#949). Real FileStorage + TasksDomain on a temp dir.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Task } from '../../../src/common/types/index.js';
import { FileStorage } from '../../../src/modules/storage/adapters/file-storage/file-storage.js';
import { createTask } from '../../../src/testing/task-fixtures.js';
import { type TmCore, createTmCore } from '../../../src/tm-core.js';
import { seedTasks } from '../seed-tasks.js';

describe('smoke gate on done', () => {
	let projectDir: string;
	let tmCore: TmCore;

	async function setup(smokeCommand: string) {
		projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-smoke-gate-'));
		const tgDir = path.join(projectDir, '.taskgraph');
		fs.mkdirSync(path.join(tgDir, 'tasks'), { recursive: true });
		fs.writeFileSync(
			path.join(tgDir, 'config.json'),
			JSON.stringify({ models: {}, global: {}, loop: { smokeCommand } })
		);
		const tasks: Task[] = [createTask({ id: '1', title: 'Task 1' })];
		await seedTasks(new FileStorage(projectDir), tasks, 'master');
		tmCore = await createTmCore({ projectPath: projectDir });
	}

	const status = async () =>
		(await new FileStorage(projectDir).loadTasks('master'))[0].status;

	afterEach(async () => {
		vi.unstubAllEnvs();
		await tmCore?.close();
		fs.rmSync(projectDir, { recursive: true, force: true });
	});

	it('refuses done in a loop run while the smoke command fails, and leaves the task as it was', async () => {
		vi.stubEnv('TASKGRAPH_LOOP_CHILD', '1');
		await setup('node -e "process.exit(1)"');

		await expect(tmCore.tasks.updateStatus('1', 'done')).rejects.toThrow(
			/smoke check/
		);
		expect(await status()).toBe('pending');
	});

	it('marks done in a loop run once the smoke command passes', async () => {
		vi.stubEnv('TASKGRAPH_LOOP_CHILD', '1');
		await setup('node -e "process.exit(0)"');

		await tmCore.tasks.updateStatuses(['1'], 'done');

		expect(await status()).toBe('done');
	});

	it('skips the smoke command outside a loop run and with force', async () => {
		vi.stubEnv('TASKGRAPH_LOOP_CHILD', '');
		await setup('node -e "process.exit(1)"');
		await tmCore.tasks.updateStatus('1', 'done');
		expect(await status()).toBe('done');

		vi.stubEnv('TASKGRAPH_LOOP_CHILD', '1');
		await tmCore.tasks.updateStatus('1', 'pending');
		await tmCore.tasks.updateStatus('1', 'done', undefined, { force: true });
		expect(await status()).toBe('done');
	});
});
