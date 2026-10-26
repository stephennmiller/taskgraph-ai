/**
 * @fileoverview tasks.syncReadme() against a real project folder
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileStorage } from '../../../src/modules/storage/adapters/file-storage/file-storage.js';
import { createTask } from '../../../src/testing/task-fixtures.js';
import { type TmCore, createTmCore } from '../../../src/tm-core.js';
import { seedTasks } from '../seed-tasks.js';

describe('tasks.syncReadme', () => {
	let projectDir: string;
	let tmCore: TmCore;
	const readmePath = () => path.join(projectDir, 'README.md');

	beforeEach(() => {
		projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-sync-readme-'));
		const dir = path.join(projectDir, '.taskgraph');
		fs.mkdirSync(path.join(dir, 'tasks'), { recursive: true });
		fs.writeFileSync(
			path.join(dir, 'config.json'),
			JSON.stringify({ models: {}, global: { projectName: 'App' } })
		);
	});

	afterEach(async () => {
		await tmCore?.close();
		fs.rmSync(projectDir, { recursive: true, force: true });
	});

	it('refuses a project with no tasks file and leaves README.md alone', async () => {
		fs.writeFileSync(readmePath(), '# Mine\n');
		tmCore = await createTmCore({ projectPath: projectDir });

		await expect(tmCore.tasks.syncReadme()).rejects.toThrow(
			`No tasks file at ${path.join(projectDir, '.taskgraph', 'tasks', 'tasks.json')}`
		);
		expect(() => tmCore.tasks.requireTasksFile()).toThrow('No tasks file');
		expect(fs.readFileSync(readmePath(), 'utf8')).toBe('# Mine\n');
	});

	it('writes the tasks into a new README.md', async () => {
		await seedTasks(
			new FileStorage(projectDir),
			[createTask({ id: 1, title: 'Set up the database' })],
			'master'
		);
		tmCore = await createTmCore({ projectPath: projectDir });

		await tmCore.tasks.syncReadme();

		const readme = fs.readFileSync(readmePath(), 'utf8');
		expect(readme.startsWith('# App\n')).toBe(true);
		expect(readme).toContain('| 1 | Set up the database |');
	});
});
