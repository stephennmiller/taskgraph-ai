/**
 * @fileoverview `loop --parallel --container` against a real git repository
 * and tasks.json, with docker replaced by a fake executable. Its `run` acts
 * as the worker would inside the container: it commits in the clone, sets
 * the task's status in its copy of tasks.json, and then plants a hook and a
 * `core.fsmonitor` command in the clone, which the host must never run.
 *
 * @integration
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/common/logger/index.js', () => {
	const mockLogger = {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		child: vi.fn().mockReturnThis()
	};
	return {
		createLogger: () => mockLogger,
		getLogger: () => mockLogger
	};
});

import { type TmCore, createTmCore } from '../../../src/index.js';

const FAKE_DOCKER = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_DOCKER_LOG, JSON.stringify(args) + '\\n');
const [command, ...rest] = args;
if (command === 'version') process.exit(process.env.FAKE_DOCKER_DOWN ? 1 : 0);
if (command === 'rm') process.exit(0);
if (process.env.FAKE_DOCKER_MODE === 'fail') process.exit(125);
const cwd = rest[rest.indexOf('--workdir') + 1];
const state = rest
	.find((a) => a.startsWith('TASKGRAPH_PROJECT_ROOT='))
	.slice('TASKGRAPH_PROJECT_ROOT='.length);
const id = path.basename(cwd).slice('task-'.length);
fs.writeFileSync(path.join(cwd, 'work.txt'), 'done\\n');
execFileSync('git', ['add', 'work.txt'], { cwd });
execFileSync('git', ['commit', '-q', '-m', 'work on ' + id], { cwd });
const file = path.join(state, '.taskgraph', 'tasks', 'tasks.json');
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
data.master.tasks.find((t) => t.id === id).status = 'review';
fs.writeFileSync(file, JSON.stringify(data));
if (process.env.FAKE_DOCKER_MODE === 'lose-branch') {
	execFileSync('git', ['checkout', '-q', '--detach'], { cwd });
	execFileSync('git', ['branch', '-q', '-D', 'taskgraph/task-' + id], { cwd });
}
const pwn = 'touch ' + JSON.stringify(process.env.FAKE_PWNED);
fs.mkdirSync(path.join(cwd, '.git', 'hooks'), { recursive: true });
for (const hook of ['post-checkout', 'pre-commit', 'reference-transaction']) {
	fs.writeFileSync(path.join(cwd, '.git', 'hooks', hook), '#!/bin/sh\\n' + pwn + '\\n', { mode: 0o755 });
}
fs.appendFileSync(path.join(cwd, '.git', 'config'), '[core]\\n\\tfsmonitor = ' + JSON.stringify(pwn) + '\\n');
`;

const task = (id: string) => ({
	id,
	title: `Task ${id}`,
	description: `Do task ${id}`,
	status: 'pending',
	priority: 'medium',
	dependencies: [],
	details: '',
	testStrategy: '',
	subtasks: []
});

const git = (cwd: string, ...args: string[]) =>
	execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

describe('loop --parallel --container', () => {
	let root: string;
	let docker: string;
	let dockerLog: string;
	let pwned: string;
	let tmCore: TmCore;

	const readTasks = () =>
		JSON.parse(
			fs.readFileSync(
				path.join(root, '.taskgraph', 'tasks', 'tasks.json'),
				'utf8'
			)
		).master.tasks as Array<{ id: string; status: string }>;
	const dockerCalls = () =>
		fs.existsSync(dockerLog)
			? fs
					.readFileSync(dockerLog, 'utf8')
					.trim()
					.split('\n')
					.map((l) => JSON.parse(l) as string[])
			: [];
	const runParallel = () =>
		tmCore.loop.runParallel({
			parallel: 1,
			trusted: true,
			claimant: 'tester',
			container: { runtime: docker }
		});

	beforeEach(async () => {
		const base = fs.realpathSync(
			fs.mkdtempSync(path.join(os.tmpdir(), 'tm-loop-container-'))
		);
		root = path.join(base, 'repo');
		docker = path.join(base, 'docker');
		dockerLog = path.join(base, 'docker.log');
		pwned = path.join(base, 'pwned');
		fs.mkdirSync(path.join(root, '.taskgraph', 'tasks'), { recursive: true });
		fs.writeFileSync(docker, FAKE_DOCKER, { mode: 0o755 });
		vi.stubEnv('FAKE_DOCKER_LOG', dockerLog);
		vi.stubEnv('FAKE_PWNED', pwned);
		vi.stubEnv('CLAUDE_CODE_OAUTH_TOKEN', 'test-token');
		fs.writeFileSync(
			path.join(root, '.taskgraph', 'tasks', 'tasks.json'),
			JSON.stringify({ master: { tasks: [task('1')], metadata: {} } }, null, 2)
		);
		fs.writeFileSync(path.join(root, 'README.md'), '# test\n');
		git(root, 'init', '-q', '-b', 'main');
		git(root, 'config', 'user.email', 'test@example.com');
		git(root, 'config', 'user.name', 'Test');
		git(root, 'config', 'commit.gpgsign', 'false');
		git(root, 'add', '.');
		git(root, 'commit', '-q', '-m', 'init');
		tmCore = await createTmCore({ projectPath: root });
	});

	afterEach(async () => {
		vi.unstubAllEnvs();
		await tmCore?.close();
		fs.rmSync(path.dirname(root), { recursive: true, force: true });
	});

	it("brings the branch and the status back, and never runs the clone's hooks or config", async () => {
		const result = await runParallel();

		expect(result.tasks).toMatchObject([
			{ id: '1', state: 'done', commits: 1, kept: true }
		]);
		expect(git(root, 'log', '--format=%s', 'main..taskgraph/task-1')).toBe(
			'work on 1'
		);
		expect(readTasks()[0].status).toBe('review');
		const clone = path.join(root, '.taskgraph', 'worktrees', 'task-1');
		expect(fs.existsSync(clone)).toBe(false);
		expect(fs.existsSync(`${clone}.state`)).toBe(false);
		expect(fs.existsSync(pwned)).toBe(false);

		const run = dockerCalls().find((c) => c[0] === 'run') ?? [];
		const mounts = run.filter((_, i) => run[i - 1] === '--mount');
		expect(mounts).toEqual([
			`type=bind,src=${clone},dst=${clone}`,
			`type=bind,src=${clone}.state,dst=${clone}.state`
		]);
		expect(run).not.toContain('test-token');
		const name = run[run.indexOf('--name') + 1];
		expect(dockerCalls()).toContainEqual(['rm', '--force', name]);
	});

	it("keeps the clone, made safe, when the branch can't be brought back", async () => {
		vi.stubEnv('FAKE_DOCKER_MODE', 'lose-branch');

		const result = await runParallel();

		const clone = path.join(root, '.taskgraph', 'worktrees', 'task-1');
		expect(result.tasks[0]).toMatchObject({ state: 'failed', kept: true });
		expect(result.tasks[0].error).toContain(
			'its clone is kept in .taskgraph/worktrees/task-1'
		);
		const config = fs.readFileSync(path.join(clone, '.git', 'config'), 'utf8');
		expect(config).not.toContain('fsmonitor');
		expect(config).toContain('email = "test@example.com"');
		expect(fs.existsSync(path.join(clone, '.git', 'hooks'))).toBe(false);
		expect(fs.existsSync(pwned)).toBe(false);
	});

	it('refuses before claiming anything when no token is set', async () => {
		vi.stubEnv('CLAUDE_CODE_OAUTH_TOKEN', '');
		vi.stubEnv('ANTHROPIC_API_KEY', '');

		await expect(runParallel()).rejects.toThrow(
			'--container needs CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY'
		);
		expect(readTasks()[0].status).toBe('pending');
		expect(dockerCalls()).toEqual([]);
	});

	it("refuses before claiming anything when docker isn't running", async () => {
		vi.stubEnv('FAKE_DOCKER_DOWN', '1');

		await expect(runParallel()).rejects.toThrow("isn't running");
		expect(readTasks()[0].status).toBe('pending');
		expect(dockerCalls().map((c) => c[0])).toEqual(['version']);
	});

	it('releases the claim and cleans up when the container fails to start', async () => {
		vi.stubEnv('FAKE_DOCKER_MODE', 'fail');

		const result = await runParallel();

		expect(result.tasks).toMatchObject([
			{ id: '1', state: 'failed', error: 'exit 125', kept: false }
		]);
		expect(readTasks()[0].status).toBe('pending');
		expect(
			fs.existsSync(path.join(root, '.taskgraph', 'worktrees', 'task-1'))
		).toBe(false);
		expect(git(root, 'branch', '--list', 'taskgraph/task-1')).toBe('');
	});
});
