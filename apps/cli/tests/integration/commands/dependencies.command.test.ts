/**
 * @fileoverview Integration tests for `validate-dependencies` and
 * `fix-dependencies`, run against the built CLI.
 *
 * @integration
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getCliBinPath } from '../../helpers/test-utils.js';

describe('dependency commands', () => {
	let dir: string;
	let home: string;

	const run = (args: string[]) =>
		spawnSync('node', [getCliBinPath(), ...args], {
			cwd: dir,
			encoding: 'utf8',
			input: '',
			timeout: 30000,
			env: {
				...process.env,
				HOME: home,
				FORCE_COLOR: '0',
				COLUMNS: '80',
				TASKGRAPH_SKIP_AUTO_UPDATE: '1'
			}
		});

	const tasksFile = () => path.join(dir, '.taskgraph', 'tasks', 'tasks.json');

	/** Set a task's dependencies directly, as a hand edit would */
	const setDependencies = (taskIndex: number, dependencies: unknown[]) => {
		const data = JSON.parse(fs.readFileSync(tasksFile(), 'utf8'));
		data.master.tasks[taskIndex].dependencies = dependencies;
		fs.writeFileSync(tasksFile(), JSON.stringify(data, null, 2));
	};

	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-deps-'));
		home = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-deps-home-'));
		run(['init', '--yes', '--no-aliases', '--no-git']);
		for (const title of ['Set up the API', 'Add Postgres', 'Sign-in']) {
			run(['add-task', `--title=${title}`, `--description=${title}`]);
		}
	});

	afterEach(() => {
		fs.rmSync(dir, { recursive: true, force: true });
		fs.rmSync(home, { recursive: true, force: true });
	});

	it('validate: one line and exit 0 when there are no problems', () => {
		run(['add-dependency', '--id=2', '--depends-on=1']);
		const result = run(['validate-dependencies']);

		expect(result.status).toBe(0);
		expect(result.stdout).toContain(
			'✓ No dependency problems · 3 tasks, 1 dependency'
		);
		expect(result.stdout).not.toContain('╭');
	});

	it('validate: lists a self-dependency once and exits 1', () => {
		setDependencies(1, [99, 2]);
		const result = run(['validate-dependencies']);

		expect(result.status).toBe(1);
		expect(result.stdout).toContain('✗ 2 dependency problems');
		expect(result.stdout).toContain(
			"2  depends on task 99, which doesn't exist"
		);
		expect(result.stdout).toContain('2  depends on itself');
		expect(result.stdout).not.toContain('loop');
		expect(result.stdout).toContain('Run taskgraph fix-dependencies');
	});

	it('fix: removes the self-dependency too, so validate passes after', () => {
		setDependencies(1, [99, 2]);
		const fixed = run(['fix-dependencies']);

		expect(fixed.status).toBe(0);
		expect(fixed.stdout).toContain('✓ Fixed 2 dependency problems');
		expect(fixed.stdout).toContain('2  removed its dependency on itself');
		expect(run(['validate-dependencies']).status).toBe(0);
	});

	it('fix: reports a loop between tasks it leaves, and exits 1', () => {
		// Task 2 waits on 3 and task 3 waits on 2
		setDependencies(1, [3]);
		setDependencies(2, [2]);

		const result = run(['fix-dependencies']);

		expect(result.status).toBe(1);
		expect(result.stdout).toContain('✗ 2 dependency problems');
		expect(result.stdout).toContain('taskgraph remove-dependency');
	});

	it('add: a repeat dependency is one plain line, not a warning', () => {
		run(['add-dependency', '--id=2', '--depends-on=1']);
		const result = run(['add-dependency', '--id=2', '--depends-on=1']);

		expect(result.status).toBe(0);
		expect(result.stdout + result.stderr).toContain(
			'Task 2 already depends on task 1; nothing changed'
		);
		expect(result.stdout + result.stderr).not.toContain('⚠');
	});
});
