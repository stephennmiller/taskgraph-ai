/**
 * @fileoverview Integration tests for 'taskgraph start'
 *
 * Runs the built CLI with --dry-run, so Claude Code is never launched. Covers
 * the compact output (#182): no boxes or spinners, and a failure that says
 * why the task couldn't start, with a fix.
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
const BOXES = /[╭╮╰╯]/;
const SPINNER = /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/;

describe('start command', () => {
	let testDir: string;
	let tasksPath: string;
	let binPath: string;
	const env = {
		...process.env,
		TASKGRAPH_SKIP_AUTO_UPDATE: '1',
		COLUMNS: '80',
		NO_COLOR: '1'
	};

	beforeEach(() => {
		testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-start-test-'));
		process.chdir(testDir);
		binPath = getCliBinPath();
		spawnSync('node', [binPath, 'init', '--yes'], { env, stdio: 'pipe' });
		tasksPath = path.join(testDir, '.taskgraph', 'tasks', 'tasks.json');
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

	const writeTasks = (data: unknown) => {
		fs.writeFileSync(tasksPath, JSON.stringify(data, null, 2));
	};

	const runStart = (...args: string[]) => {
		const result = spawnSync('node', [binPath, 'start', ...args], {
			encoding: 'utf-8',
			env
		});
		return {
			stdout: result.stdout,
			stderr: result.stderr,
			exitCode: result.status
		};
	};

	/** Task 2 is in progress; its subtask 2.2 is what `next` picks */
	const project = () =>
		createTasksFile({
			tasks: [
				createTask({
					id: 1,
					title: 'Set up the database',
					status: 'done',
					priority: 'high'
				}),
				createTask({
					id: 2,
					title: 'Sign-in with sessions',
					status: 'in-progress',
					priority: 'high',
					dependencies: ['1'],
					subtasks: [
						{
							id: 1,
							parentId: '2',
							title: 'Password hashing',
							description: 'bcrypt wrappers',
							status: 'done',
							dependencies: [],
							details: ''
						},
						{
							id: 2,
							parentId: '2',
							title: 'Sessions table and cookie middleware',
							description: 'Store sessions and set an HttpOnly cookie.',
							status: 'pending',
							dependencies: [1],
							details: ''
						}
					] as any
				}),
				createTask({
					id: 3,
					title: 'Bookmark endpoints',
					status: 'pending',
					priority: 'medium',
					dependencies: ['2']
				}),
				createTask({
					id: 4,
					title: 'Settings page',
					status: 'pending',
					priority: 'low'
				})
			]
		});

	it('--dry-run prints the task it would start, with no boxes or spinners', () => {
		writeTasks(project());

		const { stdout, exitCode } = runStart('--dry-run');

		expect(exitCode).toBe(0);
		expect(stdout).toContain(
			'Dry run · Claude Code not launched for subtask 2.2'
		);
		expect(stdout).toContain(
			'Subtask 2.2  Sessions table and cookie middleware'
		);
		expect(stdout).toContain('depends on 2.1');
		expect(stdout).toContain('Next: taskgraph start 2.2 to launch Claude Code');
		expect(stdout).not.toMatch(BOXES);
		expect(stdout).not.toMatch(SPINNER);
		expect(stdout).not.toContain('TaskGraph initialized');
		for (const line of stdout.split('\n')) {
			expect(line.length).toBeLessThanOrEqual(80);
		}
	});

	it('--dry-run does not change the task status', () => {
		writeTasks(project());

		runStart('4', '--dry-run', '--force');

		const saved = JSON.parse(fs.readFileSync(tasksPath, 'utf-8'));
		const task4 = saved.master.tasks.find((t: any) => String(t.id) === '4');
		expect(task4.status).toBe('pending');
	});

	it('says another task is in progress, not "Task not found", and how to override', () => {
		writeTasks(project());

		const { stdout, stderr, exitCode } = runStart('4', '--dry-run');

		expect(exitCode).toBe(1);
		expect(stderr).toContain('Another task is in progress');
		expect(stderr).toContain('taskgraph start 4 --force');
		expect(stderr + stdout).not.toContain('Task not found');
		expect(stderr + stdout).not.toMatch(BOXES);
	});

	it('prints a missing task as an error with a hint and exits 1', () => {
		writeTasks(project());

		const { stdout, stderr, exitCode } = runStart('99', '--dry-run', '--force');

		expect(exitCode).toBe(1);
		expect(stderr).toContain('99');
		expect(stderr).toContain('not found');
		expect(stderr).toContain('taskgraph list');
		expect(stdout).not.toMatch(BOXES);
	});

	it('prints the failure as JSON with --format json', () => {
		writeTasks(project());

		const { stdout, exitCode } = runStart(
			'99',
			'--dry-run',
			'--force',
			'--format',
			'json'
		);

		expect(exitCode).toBe(1);
		const parsed = JSON.parse(stdout);
		expect(parsed.found).toBe(false);
	});

	it('says no task is ready when nothing can start', () => {
		writeTasks(
			createTasksFile({
				tasks: [createTask({ id: 1, title: 'Only task', status: 'done' })]
			})
		);

		const { stderr, exitCode } = runStart('--dry-run');

		expect(exitCode).toBe(1);
		expect(stderr).toContain('No task is ready to start');
		expect(stderr).toContain('taskgraph list');
	});
});
