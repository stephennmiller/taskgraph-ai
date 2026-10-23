/**
 * @fileoverview Integration tests for tag statistics (the data behind
 * `taskgraph tags --json`). Real FileStorage + TasksDomain on a temp dir.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileStorage } from '../../../src/modules/storage/adapters/file-storage/file-storage.js';
import { createTask } from '../../../src/testing/task-fixtures.js';
import { type TmCore, createTmCore } from '../../../src/tm-core.js';

describe('tag statistics', () => {
	let projectDir: string;
	let tmCore: TmCore;

	beforeEach(async () => {
		projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-tag-stats-'));
		const tgDir = path.join(projectDir, '.taskgraph');
		fs.mkdirSync(path.join(tgDir, 'tasks'), { recursive: true });
		fs.writeFileSync(
			path.join(tgDir, 'config.json'),
			JSON.stringify({ models: {}, global: {} })
		);
		const storage = new FileStorage(projectDir);
		await storage.saveTasks(
			[
				createTask({ id: '1', status: 'done' }),
				createTask({ id: '2', status: 'cancelled' }),
				createTask({ id: '3', status: 'pending', dependencies: ['1'] }),
				createTask({ id: '4', status: 'pending', dependencies: ['3'] })
			],
			'master'
		);
		await storage.saveTasks(
			[createTask({ id: '1', status: 'pending', dependencies: ['2'] })],
			'blocked-only'
		);
		tmCore = await createTmCore({ projectPath: projectDir });
	});

	afterEach(async () => {
		await tmCore?.close();
		fs.rmSync(projectDir, { recursive: true, force: true });
	});

	it('counts done and cancelled as complete, and counts ready tasks', async () => {
		const { tags } = await tmCore.tasks.getTagsWithStats();
		const master = tags.find((t) => t.name === 'master');

		expect(master).toMatchObject({
			taskCount: 4,
			completedTasks: 2,
			readyTasks: 1
		});
	});

	it('keeps only tags with a ready task when asked', async () => {
		const all = await tmCore.tasks.getTagsWithStats();
		const ready = await tmCore.tasks.getTagsWithStats({ ready: true });

		expect(all.tags.map((t) => t.name).sort()).toEqual([
			'blocked-only',
			'master'
		]);
		expect(ready.tags.map((t) => t.name)).toEqual(['master']);
		expect(ready.totalTags).toBe(1);
	});
});
