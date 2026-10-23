/**
 * @fileoverview Integration tests for 'taskgraph start', the deprecated
 * alias of `taskgraph loop -n 1 --id <id>` (#255).
 *
 * Runs the built CLI with a stand-in `claude` on PATH that records the
 * prompt it gets, so no real Claude Code session starts.
 *
 * @integration
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTask, createTasksFile } from '@tm/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getCliBinPath } from '../../helpers/test-utils.js';

const initialCwd = process.cwd();

describe('start command (deprecated alias of loop)', () => {
	let testDir: string;
	let promptLog: string;
	let binPath: string;
	let env: NodeJS.ProcessEnv;

	beforeEach(() => {
		testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-start-test-'));
		process.chdir(testDir);
		binPath = getCliBinPath();

		// A stand-in for Claude Code: writes its arguments to a file
		const bin = path.join(testDir, 'bin');
		promptLog = path.join(testDir, 'claude-args.txt');
		fs.mkdirSync(bin);
		fs.writeFileSync(
			path.join(bin, 'claude'),
			`#!/bin/sh\nprintf '%s\\n' "$@" > "${promptLog}"\necho done\n`,
			{ mode: 0o755 }
		);
		env = {
			...process.env,
			PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`,
			TASKGRAPH_SKIP_AUTO_UPDATE: '1',
			COLUMNS: '80',
			NO_COLOR: '1'
		};

		spawnSync('node', [binPath, 'init', '--yes'], { env, stdio: 'pipe' });
		fs.writeFileSync(
			path.join(testDir, '.taskgraph', 'tasks', 'tasks.json'),
			JSON.stringify(
				createTasksFile({
					tasks: [
						createTask({ id: 1, title: 'Set up the database' }),
						createTask({ id: 2, title: 'Build the login API' })
					]
				}),
				null,
				2
			)
		);
	});

	afterEach(() => {
		try {
			process.chdir(initialCwd);
		} catch {
			process.chdir(os.homedir());
		}
		if (testDir && fs.existsSync(testDir)) {
			fs.rmSync(testDir, { recursive: true, force: true });
		}
	});

	const run = (...args: string[]) => {
		const result = spawnSync('node', [binPath, ...args], {
			encoding: 'utf-8',
			env,
			timeout: 30000
		});
		return {
			stdout: result.stdout,
			stderr: result.stderr,
			exitCode: result.status
		};
	};

	it('prints one deprecation line, then runs one loop iteration on the task', () => {
		const { stdout, stderr, exitCode } = run('start', '2', '--trust');

		expect(exitCode).toBe(0);
		expect(stderr.trim().split('\n')[0]).toBe(
			'start is deprecated; run taskgraph loop -n 1 --id 2 instead'
		);
		expect(stdout).toContain('Loop · default preset · 1 iteration');
		expect(stdout).toContain('Task 2  Build the login API');
		expect(stdout).toContain('Iteration 1 of 1');
		expect(fs.readFileSync(promptLog, 'utf-8')).toContain(
			'Work on task 2 only.'
		);
	});

	it('takes the task from --id as well', () => {
		const { stderr, exitCode } = run('start', '--id', '1', '--trust');

		expect(exitCode).toBe(0);
		expect(stderr).toContain('run taskgraph loop -n 1 --id 1 instead');
		expect(fs.readFileSync(promptLog, 'utf-8')).toContain(
			'Work on task 1 only.'
		);
	});

	it('says what replaces a flag the old start had', () => {
		const { stderr, exitCode } = run('start', '2', '--dry-run');

		expect(exitCode).toBe(1);
		expect(stderr).toContain('start --dry-run is gone');
		expect(stderr).toContain('taskgraph show 2');
		expect(fs.existsSync(promptLog)).toBe(false);
	});

	it('fails before Claude starts when the task does not exist', () => {
		const { stderr, exitCode } = run('start', '9', '--trust');

		expect(exitCode).toBe(1);
		expect(stderr).toContain('Task "9" doesn\'t exist');
		expect(stderr).toContain('taskgraph list');
		expect(fs.existsSync(promptLog)).toBe(false);
	});
});
