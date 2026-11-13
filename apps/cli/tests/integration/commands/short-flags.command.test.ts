/**
 * @fileoverview `-t` meant `--title`, `--threshold` or `--tree` on four
 * commands that also take `--tag` (#1155). Run through the built CLI, an old
 * spelling there must stop with a hint and never make a tag out of a title
 * or reach the AI. The fake `claude` is installed, so a call would show in
 * its trace.
 *
 * @integration
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTask, createTasksFile } from '@tm/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	installFakeClaude,
	readTrace
} from '../../fakes/install-fake-claude.mjs';
import { getCliBinPath } from '../../helpers/test-utils.js';

const binPath = getCliBinPath();
const built = fs.existsSync(binPath);
if (!built && process.env.CI) {
	throw new Error(
		`${binPath} is missing; run npm run build before these tests in CI`
	);
}

describe.skipIf(!built)('old -t spellings', () => {
	let project: string;
	let work: string;
	let fake: ReturnType<typeof installFakeClaude>;

	const tasksFile = () =>
		path.join(project, '.taskgraph', 'tasks', 'tasks.json');
	const saved = () => fs.readFileSync(tasksFile(), 'utf8');
	const run = (...args: string[]) =>
		spawnSync(process.execPath, [binPath, ...args], {
			cwd: project,
			encoding: 'utf8',
			timeout: 25000,
			env: {
				...process.env,
				...fake.env,
				FORCE_COLOR: '0',
				TASKGRAPH_SKIP_AUTO_UPDATE: '1'
			}
		});
	/** A project with the tags `master` (one task) and `auth` */
	const withTags = () =>
		fs.writeFileSync(
			tasksFile(),
			JSON.stringify({
				...createTasksFile({
					tasks: [createTask({ id: 1, title: 'Sign-in' })]
				}),
				auth: createTasksFile().master
			})
		);

	beforeEach(() => {
		project = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-short-flags-'));
		work = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-short-flags-work-'));
		const init = spawnSync(
			process.execPath,
			[binPath, 'init', '--yes', '--no-git'],
			{
				cwd: project,
				encoding: 'utf8',
				env: { ...process.env, HOME: work, TASKGRAPH_SKIP_AUTO_UPDATE: '1' }
			}
		);
		expect(init.status).toBe(0);
		fake = installFakeClaude({ projectDir: project, workDir: work });
	});

	afterEach(() => {
		fs.rmSync(project, { recursive: true, force: true });
		fs.rmSync(work, { recursive: true, force: true });
	});

	// A project with no tasks takes any --tag as a new tag, so this is where
	// the old spelling would have made a tag named after the title
	it.each([
		[['add-task', '-t', 'Fix login', '-d', 'Sessions expire'], '--title'],
		[['add-task', '-t', 'Fix login', '--prompt', 'Add a login'], '--title'],
		[['add-task', '-tFix login', '--prompt', 'Add a login'], '--title'],
		[['add-task', '-rt', 'Fix login', '--prompt', 'Add a login'], '--title'],
		[['add-subtask', '1', '-t', 'Fix login'], '--title'],
		[['analyze-complexity', '-t', 'Fix login'], '--threshold'],
		[['research', '-t', 'Fix login'], '--tree']
	])('%j stops in a new project and names %s', (args, long) => {
		const before = fs.existsSync(tasksFile()) ? saved() : null;

		const res = run(...args);

		expect(res.status).toBe(1);
		expect(res.stderr).toBe(
			`✗ Tag "Fix login" not found\n  -t means --tag; write ${long} in full\n`
		);
		expect(fs.existsSync(tasksFile()) ? saved() : null).toBe(before);
		expect(readTrace(fake.dir)).toEqual([]);
	});

	it('names --title when the value is one of your tags and no title is left', () => {
		withTags();
		const before = saved();

		const task = run('add-task', '-t', 'auth', '-d', 'Sessions expire');
		const subtask = run('add-subtask', '1', '-t', 'auth');

		expect(task.status).toBe(1);
		expect(task.stderr).toContain('add-task needs a title');
		expect(task.stderr).toContain('-t means --tag; write --title in full');
		expect(subtask.status).toBe(1);
		expect(subtask.stderr).toContain('add-subtask needs --title');
		expect(subtask.stderr).toContain('-t means --tag; write --title in full');
		expect(saved()).toBe(before);
	});

	it('names --tree when research gets -t with no value', () => {
		const res = run('research', 'How do sessions expire?', '-t');

		expect(res.status).toBe(1);
		expect(res.stderr).toBe(
			'✗ --tag needs a value\n  -t means --tag; write --tree in full\n'
		);
		expect(readTrace(fake.dir)).toEqual([]);
	});

	it('takes -t as the tag in the new spelling', () => {
		withTags();

		const res = run('add-task', 'Reset password', '-t', 'auth');
		const list = run('list', '-t', 'auth', '-f', 'json');

		expect(res.stderr).toBe('');
		expect(res.status).toBe(0);
		expect(JSON.parse(saved()).auth.tasks[0].title).toBe('Reset password');
		expect(JSON.parse(list.stdout).tasks).toHaveLength(1);
	});

	it('keeps the usual hint for a missing tag typed as --tag', () => {
		withTags();

		const res = run('add-task', 'Reset password', '--tag', 'nope');

		expect(res.status).toBe(1);
		expect(res.stderr).toContain('Tag "nope" not found');
		expect(res.stderr).not.toContain('--title');
	});
});
