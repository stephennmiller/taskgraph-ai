/**
 * @fileoverview A failed write, or one with nothing to save, on a project
 * that has only config.json leaves no tasks.json behind (#667, #704), so
 * later commands still see a missing file.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type TmCore, createTmCore } from '../../../src/tm-core.js';

describe('failed write without tasks.json', () => {
	let projectDir: string;
	let tasksPath: string;
	let tmCore: TmCore;

	beforeEach(async () => {
		projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-no-tasks-'));
		const tgDir = path.join(projectDir, '.taskgraph');
		fs.mkdirSync(tgDir, { recursive: true });
		fs.writeFileSync(
			path.join(tgDir, 'config.json'),
			JSON.stringify({ models: {}, global: {} })
		);
		tasksPath = path.join(tgDir, 'tasks', 'tasks.json');
		tmCore = await createTmCore({ projectPath: projectDir });
	});

	afterEach(async () => {
		await tmCore?.close();
		fs.rmSync(projectDir, { recursive: true, force: true });
	});

	it('set-status on a missing task creates no tasks.json', async () => {
		await expect(tmCore.tasks.updateStatus('1', 'done')).rejects.toThrow(
			/not found/i
		);

		expect(fs.existsSync(tasksPath)).toBe(false);
	});

	it('note on a missing task creates no tasks.json', async () => {
		await expect(tmCore.tasks.addNote('1', 'progress')).rejects.toThrow(
			/not found/i
		);

		expect(fs.existsSync(tasksPath)).toBe(false);
	});

	// #704: each of these reads the tag under the write lock, finds nothing
	// to change and saves nothing
	it('next --claim with no tasks creates no tasks.json', async () => {
		await expect(tmCore.tasks.claimNext()).resolves.toBeNull();

		expect(fs.existsSync(tasksPath)).toBe(false);
	});

	it('archive with no tasks creates no tasks.json', async () => {
		await tmCore.tasks.archive({ olderThanDays: 30 });

		expect(fs.existsSync(tasksPath)).toBe(false);
	});

	it('fix-dependencies with no tasks creates no tasks.json', async () => {
		await tmCore.tasks.fixDependencies();

		expect(fs.existsSync(tasksPath)).toBe(false);
	});
});
