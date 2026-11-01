/**
 * @fileoverview `loop --parallel --container` against a real git repository
 * and tasks.json, with docker replaced by a fake executable. Its `run` acts
 * as the worker would inside the container: it commits in the clone, sets
 * the task's status in its copy of tasks.json, and then plants hooks and a
 * `core.fsmonitor` command in the clone, which the host must never run.
 * FAKE_DOCKER_MODE makes it misbehave in one way; `hang` makes it wait
 * until `rm` kills it, and FAKE_DOCKER_STUCK makes `rm` fail. FAKE_DOCKER_LOST
 * makes every later call fail as an unreachable daemon does, and
 * FAKE_DOCKER_PS is what `ps` prints (`fail` makes it fail).
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
const env = process.env;
const args = process.argv.slice(2);
fs.appendFileSync(env.FAKE_DOCKER_LOG, JSON.stringify(args) + '\\n');
const [command, ...rest] = args;
const pidFile = (name) => path.join(env.FAKE_PIDS, name);
const lost = path.join(env.FAKE_PIDS, '..', 'daemon-lost');
if (command === 'version') {
	process.exit(env.FAKE_DOCKER_DOWN || fs.existsSync(lost) ? 1 : 0);
}
if (command === 'ps') {
	process.stdout.write(env.FAKE_DOCKER_PS ?? '');
	process.exit(env.FAKE_DOCKER_PS === 'fail' ? 1 : 0);
}
if (env.FAKE_DOCKER_LOST && command !== 'run') {
	fs.writeFileSync(lost, '');
	console.error('Cannot connect to the Docker daemon');
	process.exit(1);
}
if (command === 'rm') {
	if (env.FAKE_DOCKER_STUCK) process.exit(1);
	for (const name of rest.slice(1)) {
		try {
			process.kill(Number(fs.readFileSync(pidFile(name), 'utf8')), 'SIGKILL');
		} catch {}
		fs.rmSync(pidFile(name), { force: true });
	}
	process.exit(0);
}
if (command === 'container') process.exit(fs.existsSync(pidFile(rest[1])) ? 0 : 1);
const mode = env.FAKE_DOCKER_MODE;
if (mode === 'fail') process.exit(125);
const name = rest[rest.indexOf('--name') + 1];
const cwd = rest[rest.indexOf('--workdir') + 1];
const state = rest
	.find((a) => a.startsWith('TASKGRAPH_PROJECT_ROOT='))
	.slice('TASKGRAPH_PROJECT_ROOT='.length);
const id = path.basename(cwd).slice('task-'.length);
const sh = (...a) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim();
fs.writeFileSync(
	env.FAKE_SEEN,
	JSON.stringify({
		state: fs.readdirSync(path.join(state, '.taskgraph')).sort(),
		branches: sh('branch', '--format=%(refname:short)'),
		tags: sh('tag')
	})
);
if (mode === 'hang' || env.FAKE_DOCKER_STUCK || env.FAKE_DOCKER_LOST) {
	// Only rm stops a hung container, as a killed docker client doesn't
	if (mode === 'hang') process.on('SIGTERM', () => {});
	fs.writeFileSync(path.join(cwd, 'wip.txt'), 'wip\\n');
	fs.writeFileSync(pidFile(name), String(process.pid));
	setInterval(() => {}, 1000);
	return;
}
fs.writeFileSync(path.join(cwd, 'work.txt'), 'done\\n');
if (mode === 'claude-files') {
	fs.mkdirSync(path.join(cwd, '.claude'), { recursive: true });
	fs.writeFileSync(path.join(cwd, '.claude', 'settings.json'), '{"hooks":{}}\\n');
}
sh('add', '-A');
sh('commit', '-q', '-m', 'work on ' + id);
const file = path.join(state, '.taskgraph', 'tasks', 'tasks.json');
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
data.master.tasks.find((t) => t.id === id).status = 'review';
fs.writeFileSync(file, JSON.stringify(data));
if (mode === 'lose-branch') {
	sh('checkout', '-q', '--detach');
	sh('branch', '-q', '-D', 'taskgraph/task-' + id);
}
if (mode === 'symlink-packed-refs') {
	fs.symlinkSync(env.FAKE_OUTSIDE, path.join(cwd, '.git', 'packed-refs'));
}
const pwn = 'touch ' + JSON.stringify(env.FAKE_PWNED);
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
	let base: string;
	let root: string;
	let clone: string;
	let tmCore: TmCore;
	const file = (name: string) => path.join(base, name);

	const readTask = () =>
		JSON.parse(
			fs.readFileSync(
				path.join(root, '.taskgraph', 'tasks', 'tasks.json'),
				'utf8'
			)
		).master.tasks[0] as {
			status: string;
			metadata?: { claimedBy?: string };
		};
	const dockerCalls = () =>
		fs.existsSync(file('docker.log'))
			? fs
					.readFileSync(file('docker.log'), 'utf8')
					.trim()
					.split('\n')
					.map((l) => JSON.parse(l) as string[])
			: [];
	const runParallel = (signal?: AbortSignal) =>
		tmCore.loop.runParallel({
			parallel: 1,
			trusted: true,
			claimant: 'tester',
			container: { runtime: file('docker') },
			signal,
			killGraceMs: 100
		});

	beforeEach(async () => {
		base = fs.realpathSync(
			fs.mkdtempSync(path.join(os.tmpdir(), 'tm-loop-container-'))
		);
		root = path.join(base, 'repo');
		clone = path.join(root, '.taskgraph', 'worktrees', 'task-1');
		fs.mkdirSync(path.join(root, '.taskgraph', 'tasks'), { recursive: true });
		fs.mkdirSync(file('pids'));
		fs.writeFileSync(file('docker'), FAKE_DOCKER, { mode: 0o755 });
		fs.writeFileSync(file('outside'), 'host file\n');
		vi.stubEnv('FAKE_DOCKER_LOG', file('docker.log'));
		vi.stubEnv('FAKE_PIDS', file('pids'));
		vi.stubEnv('FAKE_SEEN', file('seen.json'));
		vi.stubEnv('FAKE_PWNED', file('pwned'));
		vi.stubEnv('FAKE_OUTSIDE', file('outside'));
		vi.stubEnv('CLAUDE_CODE_OAUTH_TOKEN', 'test-token');
		fs.writeFileSync(
			path.join(root, '.taskgraph', 'tasks', 'tasks.json'),
			JSON.stringify({ master: { tasks: [task('1')], metadata: {} } }, null, 2)
		);
		fs.writeFileSync(path.join(root, '.taskgraph', 'config.json'), '{}');
		fs.writeFileSync(path.join(root, 'README.md'), '# test\n');
		git(root, 'init', '-q', '-b', 'main');
		git(root, 'config', 'user.email', 'test@example.com');
		git(root, 'config', 'user.name', 'Test');
		git(root, 'config', 'commit.gpgsign', 'false');
		git(root, 'add', '.');
		git(root, 'commit', '-q', '-m', 'init');
		git(root, 'tag', 'v1');
		git(root, 'branch', 'secret-branch');
		// Untracked and may hold API keys: must not reach the container
		fs.writeFileSync(
			path.join(root, '.taskgraph', 'config.local.json'),
			'{"apiKey":"x"}'
		);
		tmCore = await createTmCore({ projectPath: root });
	});

	afterEach(async () => {
		vi.unstubAllEnvs();
		await tmCore?.close();
		for (const name of fs.readdirSync(file('pids'))) {
			try {
				process.kill(Number(fs.readFileSync(file(`pids/${name}`), 'utf8')));
			} catch {}
		}
		fs.rmSync(base, { recursive: true, force: true });
	});

	it("brings the branch and the status back, and never runs the clone's hooks or config", async () => {
		const result = await runParallel();

		expect(result.tasks).toMatchObject([
			{ id: '1', state: 'done', commits: 1, kept: true, finished: true }
		]);
		expect(git(root, 'log', '--format=%s', 'main..taskgraph/task-1')).toBe(
			'work on 1'
		);
		expect(readTask().status).toBe('review');
		expect(fs.existsSync(clone)).toBe(false);
		expect(fs.existsSync(`${clone}.state`)).toBe(false);
		expect(fs.existsSync(file('pwned'))).toBe(false);

		const run = dockerCalls().find((c) => c[0] === 'run') ?? [];
		expect(run.filter((_, i) => run[i - 1] === '--mount')).toEqual([
			`type=bind,src=${clone},dst=${clone}`,
			`type=bind,src=${clone}.state,dst=${clone}.state`
		]);
		expect(run).not.toContain('test-token');
		const name = run[run.indexOf('--name') + 1];
		expect(dockerCalls()).toContainEqual(['rm', '--force', name]);
		expect(dockerCalls()).toContainEqual(['container', 'inspect', name]);
	});

	it("gives the container only the task's branch, and no config.local.json", async () => {
		await runParallel();

		const seen = JSON.parse(fs.readFileSync(file('seen.json'), 'utf8'));
		expect(seen.branches).toBe('taskgraph/task-1');
		expect(seen.tags).toBe('');
		expect(seen.state).toEqual(['config.json', 'tasks']);
	});

	it("doesn't import the status, and keeps the claim, when the branch can't be brought back", async () => {
		vi.stubEnv('FAKE_DOCKER_MODE', 'lose-branch');

		const result = await runParallel();

		expect(result.tasks[0]).toMatchObject({ state: 'failed', kept: true });
		expect(result.tasks[0].error).toBe(
			"couldn't bring the branch back (couldn't find remote ref refs/heads/taskgraph/task-1); its clone is kept in .taskgraph/worktrees/task-1"
		);
		expect(readTask()).toMatchObject({
			status: 'in-progress',
			metadata: { claimedBy: 'tester' }
		});
		const config = fs.readFileSync(path.join(clone, '.git', 'config'), 'utf8');
		expect(config).not.toContain('fsmonitor');
		expect(fs.existsSync(path.join(clone, '.git', 'hooks'))).toBe(false);
		expect(fs.existsSync(file('pwned'))).toBe(false);
	});

	it('removes the git data of a clone that has a symlink in its .git, and keeps its files', async () => {
		vi.stubEnv('FAKE_DOCKER_MODE', 'symlink-packed-refs');

		const result = await runParallel();

		expect(result.tasks[0].state).toBe('failed');
		expect(result.tasks[0].error).toContain(
			"its git data was unsafe (.git/packed-refs isn't a plain file or folder)"
		);
		expect(fs.existsSync(path.join(clone, '.git'))).toBe(false);
		expect(fs.existsSync(path.join(clone, 'work.txt'))).toBe(true);
		expect(fs.readFileSync(file('outside'), 'utf8')).toBe('host file\n');
		expect(readTask().status).toBe('in-progress');
	});

	it('starts no container on a task branch that was already here with other commits', async () => {
		git(root, 'checkout', '-q', '-b', 'taskgraph/task-1');
		fs.writeFileSync(path.join(root, 'CLAUDE.md'), 'Other instructions\n');
		git(root, 'add', 'CLAUDE.md');
		git(root, 'commit', '-qm', 'from a pull request');
		git(root, 'checkout', '-q', 'main');

		const result = await runParallel();

		expect(result.tasks[0]).toMatchObject({
			state: 'failed',
			error: expect.stringContaining('git branch -m taskgraph/task-1')
		});
		expect(dockerCalls().some(([command]) => command === 'run')).toBe(false);
		expect(fs.existsSync(clone)).toBe(false);
		expect(readTask().status).toBe('pending');
	});

	it("doesn't count a container's commits as where the last run left the branch", async () => {
		vi.stubEnv('FAKE_DOCKER_MODE', 'claude-files');
		const first = await runParallel();
		expect(first.tasks[0]).toMatchObject({ state: 'done', kept: true });
		const data = JSON.parse(
			fs.readFileSync(
				path.join(root, '.taskgraph', 'tasks', 'tasks.json'),
				'utf8'
			)
		);
		data.master.tasks[0].status = 'pending';
		fs.writeFileSync(
			path.join(root, '.taskgraph', 'tasks', 'tasks.json'),
			JSON.stringify(data)
		);

		const second = await runParallel();

		expect(second.tasks[0]).toMatchObject({
			state: 'failed',
			error: expect.stringContaining('changes .claude/settings.json')
		});
	});

	it('on abort removes the container by name, keeps the clone, releases the claim; a rerun reuses the clone', async () => {
		vi.stubEnv('FAKE_DOCKER_MODE', 'hang');
		const controller = new AbortController();
		const running = runParallel(controller.signal);
		await vi.waitFor(
			() => expect(fs.readdirSync(file('pids'))).toHaveLength(1),
			{ timeout: 10_000 }
		);
		const [name] = fs.readdirSync(file('pids'));

		controller.abort();
		const result = await running;

		expect(result.aborted).toBe(true);
		expect(result.tasks[0]).toMatchObject({ state: 'stopped', kept: true });
		expect(dockerCalls()).toContainEqual(['rm', '--force', name]);
		expect(readTask().status).toBe('pending');
		expect(fs.readFileSync(path.join(clone, 'wip.txt'), 'utf8')).toBe('wip\n');

		vi.stubEnv('FAKE_DOCKER_MODE', '');
		const rerun = await runParallel();

		expect(rerun.tasks[0]).toMatchObject({ state: 'done', commits: 1 });
		expect(
			git(root, 'show', '--name-only', '--format=', 'taskgraph/task-1')
				.split('\n')
				.sort()
		).toEqual(['wip.txt', 'work.txt']);
	});

	it('removes a container that runs past TASKGRAPH_LOOP_TIMEOUT_MS, keeps the clone, releases the claim', async () => {
		vi.stubEnv('FAKE_DOCKER_MODE', 'hang');
		// Long enough for a slow CI runner to start the worker before it fires
		vi.stubEnv('TASKGRAPH_LOOP_TIMEOUT_MS', '3000');

		// A grace period past the test's own timeout: only rm can end it in time
		const result = await tmCore.loop.runParallel({
			parallel: 1,
			trusted: true,
			claimant: 'tester',
			container: { runtime: file('docker') },
			killGraceMs: 60_000
		});

		expect(result.tasks[0]).toMatchObject({ state: 'failed', kept: true });
		expect(result.tasks[0].error).toContain('TASKGRAPH_LOOP_TIMEOUT_MS');
		expect(dockerCalls().some(([command]) => command === 'rm')).toBe(true);
		expect(readTask().status).toBe('pending');
		expect(fs.readFileSync(path.join(clone, 'wip.txt'), 'utf8')).toBe('wip\n');
	}, 20_000);

	it("leaves the clone and the claim alone when the container won't go away", async () => {
		vi.stubEnv('FAKE_DOCKER_STUCK', '1');
		const controller = new AbortController();
		const running = runParallel(controller.signal);
		await vi.waitFor(
			() => expect(fs.readdirSync(file('pids'))).toHaveLength(1),
			{ timeout: 10_000 }
		);
		const [name] = fs.readdirSync(file('pids'));

		controller.abort();
		const result = await running;

		expect(result.tasks[0]).toMatchObject({ state: 'failed', kept: true });
		expect(result.tasks[0].error).toBe(
			`its container may still be running; remove it with docker rm -f ${name}`
		);
		expect(readTask()).toMatchObject({
			status: 'in-progress',
			metadata: { claimedBy: 'tester' }
		});
		expect(fs.existsSync(path.join(clone, '.git'))).toBe(true);
		expect(fs.existsSync(`${clone}.state`)).toBe(true);
	});

	it('counts a container as still there when the daemon stops answering', async () => {
		vi.stubEnv('FAKE_DOCKER_LOST', '1');
		const controller = new AbortController();
		const running = runParallel(controller.signal);
		await vi.waitFor(
			() => expect(fs.readdirSync(file('pids'))).toHaveLength(1),
			{ timeout: 10_000 }
		);
		const [name] = fs.readdirSync(file('pids'));

		controller.abort();
		const result = await running;

		expect(result.tasks[0]).toMatchObject({ state: 'failed', kept: true });
		expect(result.tasks[0].error).toBe(
			`its container may still be running; remove it with docker rm -f ${name}`
		);
		expect(dockerCalls()).toContainEqual(['container', 'inspect', name]);
		expect(readTask()).toMatchObject({
			status: 'in-progress',
			metadata: { claimedBy: 'tester' }
		});
		expect(fs.existsSync(path.join(clone, '.git'))).toBe(true);
	});

	it('refuses to reuse a kept clone while an earlier container is listed, or when it cannot tell', async () => {
		vi.stubEnv('FAKE_DOCKER_MODE', 'hang');
		const controller = new AbortController();
		const running = runParallel(controller.signal);
		await vi.waitFor(
			() => expect(fs.readdirSync(file('pids'))).toHaveLength(1),
			{ timeout: 10_000 }
		);
		controller.abort();
		await running;
		vi.stubEnv('FAKE_DOCKER_MODE', '');
		const before = dockerCalls().length;

		vi.stubEnv('FAKE_DOCKER_PS', 'taskgraph-task-1-abcd1234\n');
		const listed = await runParallel();
		vi.stubEnv('FAKE_DOCKER_PS', 'fail');
		const unknown = await runParallel();

		expect(listed.tasks[0]).toMatchObject({
			state: 'failed',
			error:
				'task 1 still has a container; remove it with docker rm -f taskgraph-task-1-abcd1234'
		});
		expect(unknown.tasks[0]).toMatchObject({ state: 'failed' });
		expect(unknown.tasks[0].error).toContain(
			"couldn't check that task 1 has no container left"
		);
		const later = dockerCalls()
			.slice(before)
			.map((c) => c[0]);
		expect(later).not.toContain('run');
		expect(later).toContain('ps');
		expect(dockerCalls().slice(before)).toContainEqual([
			'ps',
			'-a',
			'--format',
			'{{.Names}}',
			'--filter',
			'name=^/?taskgraph-task-1-'
		]);
		expect(fs.readFileSync(path.join(clone, 'wip.txt'), 'utf8')).toBe('wip\n');
		expect(readTask().status).toBe('pending');
	});

	it('refuses before claiming anything when no token is set', async () => {
		vi.stubEnv('CLAUDE_CODE_OAUTH_TOKEN', '');
		vi.stubEnv('ANTHROPIC_API_KEY', '');

		await expect(runParallel()).rejects.toThrow(
			'--container needs CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY'
		);
		expect(readTask().status).toBe('pending');
		expect(dockerCalls()).toEqual([]);
	});

	it("refuses before claiming anything when docker isn't running", async () => {
		vi.stubEnv('FAKE_DOCKER_DOWN', '1');

		await expect(runParallel()).rejects.toThrow("isn't running");
		expect(readTask().status).toBe('pending');
		expect(dockerCalls().map((c) => c[0])).toEqual(['version']);
	});

	it('releases the claim and cleans up when the container fails to start', async () => {
		vi.stubEnv('FAKE_DOCKER_MODE', 'fail');

		const result = await runParallel();

		expect(result.tasks).toMatchObject([
			{ id: '1', state: 'failed', error: 'exit 125', kept: false }
		]);
		expect(readTask().status).toBe('pending');
		expect(fs.existsSync(clone)).toBe(false);
		expect(git(root, 'branch', '--list', 'taskgraph/task-1')).toBe('');
	});
});
