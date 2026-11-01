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
import { getCliBinPath, spawnTimeout } from '../../helpers/test-utils.js';

describe('first run', () => {
	let dir: string;
	let home: string;

	// HOME points at a temp folder so init can't touch the real shell config
	const run = (
		args: string[],
		options: { cwd?: string; env?: Record<string, string> } = {}
	) =>
		spawnSync('node', [getCliBinPath(), ...args], {
			cwd: options.cwd ?? dir,
			encoding: 'utf8',
			env: {
				...process.env,
				TASKGRAPH_PROJECT_ROOT: '',
				HOME: home,
				FORCE_COLOR: '0',
				TASKGRAPH_SKIP_AUTO_UPDATE: '1',
				...options.env
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

	it('points an old `loop -p tdd` at --prompt, and `list -p` at init (#882)', () => {
		const loop = run(['loop', '-ptdd', '-n', '1']);
		const list = run(['list', '-p', dir]);

		expect(loop.status).toBe(1);
		expect(loop.stderr).toContain('-p means --project');
		expect(list.status).toBe(1);
		expect(list.stderr).toContain('taskgraph init');
		expect(list.stderr).not.toContain('--prompt');
	});

	it('gives `loop -p <existing folder>` the init hint', () => {
		const result = run(['loop', '-p', dir, '-n', '1']);

		expect(result.status).toBe(1);
		expect(result.stderr).toContain('taskgraph init');
		expect(result.stderr).not.toContain('--prompt');
	});

	it('works on the project TASKGRAPH_PROJECT_ROOT names, from any folder', {
		timeout: spawnTimeout(3)
	}, () => {
		// What a loop --parallel task worktree does
		run(['init', '--yes', '--no-aliases', '--no-git']);
		const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-first-run-'));
		const there = { cwd: elsewhere, env: { TASKGRAPH_PROJECT_ROOT: dir } };

		try {
			const add = run(
				['add-task', '--title', 'Set up CI', '--description', 'Run tests'],
				there
			);
			const status = run(['set-status', '--id=1', '--status=review'], there);

			expect(add.status).toBe(0);
			expect(status.status).toBe(0);
			const tasks = JSON.parse(
				fs.readFileSync(
					path.join(dir, '.taskgraph', 'tasks', 'tasks.json'),
					'utf8'
				)
			).master.tasks;
			expect(tasks).toMatchObject([{ id: '1', status: 'review' }]);
			expect(fs.existsSync(path.join(elsewhere, '.taskgraph'))).toBe(false);
		} finally {
			fs.rmSync(elsewhere, { recursive: true, force: true });
		}
	});

	it('names the folder TASKGRAPH_PROJECT_ROOT points at when it has no project', () => {
		const result = run(['list'], { env: { TASKGRAPH_PROJECT_ROOT: home } });

		expect(result.status).toBe(1);
		expect(result.stderr).toContain(
			`No TaskGraph project at ${home}, which TASKGRAPH_PROJECT_ROOT names`
		);
	});

	it('names the variable when --project is one of its task worktrees', () => {
		const worktree = path.join(home, '.taskgraph', 'worktrees', 'task-1');
		const result = run(['list', '--project', worktree], {
			env: { TASKGRAPH_PROJECT_ROOT: home }
		});

		expect(result.status).toBe(1);
		expect(result.stderr).toContain(
			`No TaskGraph project at ${home}, which TASKGRAPH_PROJECT_ROOT names`
		);
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

	it('adds the first task by hand right after init', () => {
		// init didn't create tasks.json, and add-task refused to run without it
		run(['init', '--yes', '--no-aliases', '--no-git']);

		const result = run([
			'add-task',
			'--title',
			'Set up CI',
			'--description',
			'Run tests on every push'
		]);

		expect(result.status).toBe(0);
		expect(result.stdout).toContain('✓ Added task 1');
	});

	it('lists tags right after init', () => {
		run(['init', '--yes', '--no-aliases', '--no-git']);

		const result = run(['tags']);

		expect(result.status).toBe(0);
		expect(result.stdout).toContain('master');
	});

	it('lists tags in an older project that has no tasks.json yet', () => {
		run(['init', '--yes', '--no-aliases', '--no-git']);
		fs.rmSync(path.join(dir, '.taskgraph', 'tasks', 'tasks.json'));

		const result = run(['tags']);

		expect(result.status).toBe(0);
		expect(result.stdout).toContain('master');
	});

	it("doesn't show the tag migration notice in a new project", {
		timeout: spawnTimeout(3)
	}, () => {
		run(['init', '--yes', '--no-aliases', '--no-git']);
		run(['add-task', '--title', 'First', '--description', 'd']);

		const result = run(['list']);

		expect(result.stdout).not.toContain('now supports separate task lists');
	});

	it('adds a task from a subfolder of the project', () => {
		// add-task looked for .taskgraph/tasks/tasks.json relative to the
		// current folder, so it failed anywhere but the project root
		spawnSync('git', ['init', '-q'], { cwd: dir });
		run(['init', '--yes', '--no-aliases']);
		const subfolder = path.join(dir, 'src', 'deep');
		fs.mkdirSync(subfolder, { recursive: true });

		const result = spawnSync(
			'node',
			[getCliBinPath(), 'add-task', '--title', 'Nested', '--description', 'd'],
			{
				cwd: subfolder,
				encoding: 'utf8',
				env: {
					...process.env,
					HOME: home,
					FORCE_COLOR: '0',
					TASKGRAPH_SKIP_AUTO_UPDATE: '1'
				}
			}
		);

		expect(result.status).toBe(0);
		expect(result.stdout).toContain('✓ Added task 1');
	});
});
