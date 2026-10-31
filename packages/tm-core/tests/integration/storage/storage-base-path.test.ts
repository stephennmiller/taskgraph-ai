/**
 * @fileoverview Tasks are read from and written to the project's own
 * .taskgraph/tasks/tasks.json, whatever storage.basePath the config holds
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FileStorage } from '../../../src/modules/storage/adapters/file-storage/file-storage.js';
import { createTask } from '../../../src/testing/task-fixtures.js';
import { type TmCore, createTmCore } from '../../../src/tm-core.js';
import { seedTasks } from '../seed-tasks.js';

describe('storage.basePath in project config', () => {
	let projectDir: string;
	let otherDir: string;
	let tmCore: TmCore;

	afterEach(async () => {
		await tmCore?.close();
		fs.rmSync(projectDir, { recursive: true, force: true });
		fs.rmSync(otherDir, { recursive: true, force: true });
	});

	it('is ignored: list and set-status use the project tasks.json', async () => {
		projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-base-path-'));
		otherDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-base-path-other-'));
		for (const [dir, title] of [
			[projectDir, 'Project task'],
			[otherDir, 'Other task']
		]) {
			fs.mkdirSync(path.join(dir, '.taskgraph/tasks'), { recursive: true });
			await seedTasks(
				new FileStorage(dir),
				[createTask({ id: 1, title, status: 'pending' })],
				'master'
			);
		}
		fs.writeFileSync(
			path.join(projectDir, '.taskgraph/config.json'),
			JSON.stringify({ storage: { type: 'file', basePath: otherDir } })
		);
		const otherTasksPath = path.join(otherDir, '.taskgraph/tasks/tasks.json');
		const otherBefore = fs.readFileSync(otherTasksPath, 'utf-8');
		tmCore = await createTmCore({ projectPath: projectDir });

		const { tasks } = await tmCore.tasks.list();
		await tmCore.tasks.updateStatus('1', 'done');

		expect(tasks.map((t) => t.title)).toEqual(['Project task']);
		const saved = JSON.parse(
			fs.readFileSync(
				path.join(projectDir, '.taskgraph/tasks/tasks.json'),
				'utf-8'
			)
		);
		expect(saved.master.tasks[0].status).toBe('done');
		expect(fs.readFileSync(otherTasksPath, 'utf-8')).toBe(otherBefore);
	});

	it('a storage setting that is not an object still lists the tasks', async () => {
		projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-base-path-'));
		otherDir = projectDir;
		fs.mkdirSync(path.join(projectDir, '.taskgraph/tasks'), {
			recursive: true
		});
		await seedTasks(
			new FileStorage(projectDir),
			[createTask({ id: 1, title: 'Project task', status: 'pending' })],
			'master'
		);
		fs.writeFileSync(
			path.join(projectDir, '.taskgraph/config.json'),
			JSON.stringify({ storage: 'file' })
		);
		tmCore = await createTmCore({ projectPath: projectDir });

		const { tasks } = await tmCore.tasks.list();

		expect(tasks.map((t) => t.title)).toEqual(['Project task']);
	});
});
