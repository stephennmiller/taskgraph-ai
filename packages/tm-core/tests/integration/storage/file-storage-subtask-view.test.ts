/**
 * @fileoverview A subtask loaded through FileStorage.loadTask has the same
 * fields as tasks.get gives it, besides the full dotted ID and resolved
 * dependencies: nothing extra copied from its parent.
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

describe('FileStorage.loadTask subtask view', () => {
	let projectDir: string;
	let storage: FileStorage;
	let tmCore: TmCore;

	beforeEach(async () => {
		projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-subtask-view-'));
		const tgDir = path.join(projectDir, '.taskgraph');
		fs.mkdirSync(path.join(tgDir, 'tasks'), { recursive: true });
		fs.writeFileSync(
			path.join(tgDir, 'config.json'),
			JSON.stringify({ models: {}, global: {} })
		);
		storage = new FileStorage(projectDir);
		await seedTasks(
			storage,
			[
				createTask({
					id: '2',
					title: 'Parent',
					priority: 'high',
					complexity: 8,
					tags: ['backend'],
					assignee: 'sam',
					createdAt: '2026-01-01T00:00:00.000Z',
					subtasks: [
						createSubtask({ id: 1, parentId: '2', title: 'First' }),
						createSubtask({
							id: 2,
							parentId: '2',
							title: 'Second',
							dependencies: [1]
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

	it('matches tasks.get, with the dotted ID and resolved dependencies', async () => {
		const loaded = await storage.loadTask('2.2', 'master');
		const { task: viaGet } = await tmCore.tasks.get('2.2');

		expect(loaded).toEqual({
			...viaGet,
			id: '2.2',
			dependencies: ['2.1'],
			subtasks: []
		});
		expect(loaded?.complexity).toBeUndefined();
		expect(loaded).not.toHaveProperty('parentTask');
	});
});
