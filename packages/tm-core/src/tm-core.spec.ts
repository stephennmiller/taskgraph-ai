/**
 * @fileoverview createTmCore's requireProject option (#1108): the MCP server
 * passes it so a tool call can't open, and so start, a project in a folder
 * that isn't one.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTmCore } from './tm-core.js';

describe('createTmCore with requireProject', () => {
	let project: string;

	beforeEach(() => {
		project = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-require-project-'));
		fs.mkdirSync(path.join(project, '.taskgraph'));
		fs.writeFileSync(path.join(project, '.taskgraph', 'config.json'), '{}');
		fs.mkdirSync(path.join(project, 'sub'));
	});

	afterEach(() => fs.rmSync(project, { recursive: true, force: true }));

	it.each([
		['a folder inside a project', 'sub'],
		['a path that does not exist', 'missing/deeper']
	])('refuses %s and creates nothing', async (_name, relative) => {
		const root = path.join(project, relative);

		await expect(
			createTmCore({ projectPath: root, requireProject: true })
		).rejects.toThrow(`No TaskGraph project at ${root}`);

		expect(fs.readdirSync(path.join(project, 'sub'))).toEqual([]);
		expect(fs.existsSync(path.join(project, 'missing'))).toBe(false);
	});

	it('opens a project', async () => {
		const tmCore = await createTmCore({
			projectPath: project,
			requireProject: true
		});

		expect(tmCore.projectPath).toBe(project);
		await tmCore.close();
	});
});
