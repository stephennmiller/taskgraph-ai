/**
 * @fileoverview Integration tests for what a new user sees first: `init`, and
 * any other command run before there's a project.
 *
 * @integration
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getCliBinPath } from '../../helpers/test-utils.js';

describe('first run', () => {
	let dir: string;
	let home: string;

	// HOME points at a temp folder so init can't touch the real shell config
	const run = (args: string[]) =>
		spawnSync('node', [getCliBinPath(), ...args], {
			cwd: dir,
			encoding: 'utf8',
			env: {
				...process.env,
				HOME: home,
				FORCE_COLOR: '0',
				TASKGRAPH_SKIP_AUTO_UPDATE: '1'
			}
		});

	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-first-run-'));
		home = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-first-run-home-'));
	});

	afterEach(() => {
		fs.rmSync(dir, { recursive: true, force: true });
		fs.rmSync(home, { recursive: true, force: true });
	});

	it('stops a command run outside a project with one message', () => {
		const result = run(['list']);

		expect(result.status).toBe(1);
		expect(result.stderr).toContain('No TaskGraph project in this folder');
		expect(result.stderr).toContain('taskgraph init');
		expect(result.stderr).not.toContain('Configuration file not found');
	});

	it('leaves no .taskgraph folder behind', () => {
		// `list`, `next` and `tags` used to create an empty one
		for (const command of ['list', 'next', 'tags']) run([command]);

		expect(fs.existsSync(path.join(dir, '.taskgraph'))).toBe(false);
	});

	it('names the folder when --project points somewhere without a project', () => {
		const result = run(['list', '--project', dir]);

		expect(result.status).toBe(1);
		expect(result.stderr).toContain(`No TaskGraph project at ${dir}`);
	});

	it('summarizes init with relative paths and next steps', () => {
		const result = run(['init', '--yes', '--no-aliases', '--no-git']);

		expect(result.status).toBe(0);
		expect(result.stdout).toContain('Set up TaskGraph in');
		expect(result.stdout).toContain('.taskgraph/');
		expect(result.stdout).toContain('taskgraph parse-prd');
		// No line per file with its absolute path, no figlet "Success!" box
		expect(result.stdout).not.toContain(dir);
		expect(result.stdout).not.toContain('Success!');
	});

	it('says nothing changed when init runs again', () => {
		run(['init', '--yes', '--no-aliases', '--no-git']);
		const again = run(['init', '--yes', '--no-aliases', '--no-git']);

		expect(again.status).toBe(0);
		expect(again.stdout).toContain('TaskGraph is already set up in');
	});

	it('lets commands run once init has set the folder up', () => {
		run(['init', '--yes', '--no-aliases', '--no-git']);
		const result = run(['list']);

		expect(result.stderr).not.toContain('No TaskGraph project');
	});
});
