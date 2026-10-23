/**
 * @fileoverview `loop --parallel` against a real git repository and a real
 * tasks.json, with Claude Code replaced at the process boundary by a fake
 * executable. The fake does what a plan file says for its worktree: commit,
 * fail, do nothing, or sleep until it's killed.
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

import {
	ParallelLoopError,
	type ParallelTask,
	type TmCore,
	createTmCore
} from '../../../src/index.js';

const FAKE_CLAUDE = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const plan = JSON.parse(fs.readFileSync(process.env.FAKE_CLAUDE_PLAN, 'utf8'));
const name = path.basename(process.cwd());
console.log(JSON.stringify(process.argv.slice(2)));
const mode = plan[name] || 'nothing';
if (mode === 'commit') {
	fs.writeFileSync('work.txt', 'done\\n');
	execFileSync('git', ['add', 'work.txt']);
	execFileSync('git', ['commit', '-q', '-m', 'work on ' + name]);
	process.exit(0);
}
if (mode === 'fail') process.exit(1);
if (mode === 'sleep' || mode === 'dirty-sleep') {
	if (mode === 'dirty-sleep') fs.writeFileSync('partial.txt', 'wip\\n');
	fs.writeFileSync(path.join(plan.pidDir, name), String(process.pid));
	setInterval(() => {}, 1000);
} else {
	process.exit(0);
}
`;

const task = (id: string, dependencies: string[] = []) => ({
	id,
	title: `Task ${id}`,
	description: `Do task ${id}`,
	status: 'pending',
	priority: 'medium',
	dependencies,
	details: '',
	testStrategy: '',
	subtasks: []
});

const git = (cwd: string, ...args: string[]) =>
	execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

const isAlive = (pid: number) => {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
};

describe('loop --parallel', () => {
	let root: string;
	let binDir: string;
	let pidDir: string;
	let planFile: string;
	let tmCore: TmCore;
	const fakeClaude = () => path.join(binDir, 'claude');

	const readTasks = () =>
		JSON.parse(
			fs.readFileSync(
				path.join(root, '.taskgraph', 'tasks', 'tasks.json'),
				'utf8'
			)
		).master.tasks as Array<{
			id: string;
			status: string;
			metadata?: Record<string, unknown>;
		}>;
	const taskById = (id: string) => readTasks().find((t) => t.id === id);
	const branchExists = (branch: string) => {
		try {
			git(root, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`);
			return true;
		} catch {
			return false;
		}
	};
	const writePlan = (plan: Record<string, string>) =>
		fs.writeFileSync(planFile, JSON.stringify({ ...plan, pidDir }));

	beforeEach(async () => {
		const base = fs.realpathSync(
			fs.mkdtempSync(path.join(os.tmpdir(), 'tm-loop-parallel-'))
		);
		root = path.join(base, 'repo');
		binDir = path.join(base, 'bin');
		pidDir = path.join(base, 'pids');
		planFile = path.join(base, 'plan.json');
		for (const dir of [root, binDir, pidDir]) fs.mkdirSync(dir);
		fs.writeFileSync(fakeClaude(), FAKE_CLAUDE, { mode: 0o755 });
		vi.stubEnv('FAKE_CLAUDE_PLAN', planFile);

		fs.mkdirSync(path.join(root, '.taskgraph', 'tasks'), { recursive: true });
		fs.writeFileSync(
			path.join(root, '.taskgraph', 'tasks', 'tasks.json'),
			JSON.stringify(
				{
					master: {
						tasks: [task('1'), task('2'), task('3'), task('4', ['1'])],
						metadata: { created: new Date().toISOString() }
					}
				},
				null,
				2
			)
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
		for (const name of fs.existsSync(pidDir) ? fs.readdirSync(pidDir) : []) {
			const pid = Number(fs.readFileSync(path.join(pidDir, name), 'utf8'));
			if (isAlive(pid)) process.kill(pid, 'SIGKILL');
		}
		fs.rmSync(path.dirname(root), { recursive: true, force: true });
	});

	it('runs wave 1 in one worktree per task and keeps only the ones with work', async () => {
		writePlan({ 'task-1': 'commit', 'task-2': 'fail', 'task-3': 'nothing' });
		const started: ParallelTask[] = [];

		const result = await tmCore.loop.runParallel({
			parallel: 3,
			trusted: true,
			claimant: 'tester',
			command: fakeClaude(),
			callbacks: {
				onTaskStart: (t) => {
					started.push(t);
					expect(fs.existsSync(t.worktree)).toBe(true);
					expect(git(t.worktree, 'branch', '--show-current')).toBe(t.branch);
					expect(taskById(t.id)).toMatchObject({
						status: 'in-progress',
						metadata: { claimedBy: 'tester' }
					});
				}
			}
		});

		// Task 4 waits on task 1, so wave 1 is 1, 2 and 3
		expect(result.readyCount).toBe(3);
		expect(started.map((t) => t.id).sort()).toEqual(['1', '2', '3']);
		expect(result.aborted).toBe(false);
		const byId = Object.fromEntries(result.tasks.map((t) => [t.id, t]));

		// Claude got the prompt as one argv entry, with permission prompts off
		const argv = JSON.parse(
			fs.readFileSync(byId['1'].logFile, 'utf8').split('\n')[0]
		);
		expect(argv[0]).toBe('-p');
		expect(argv[1]).toContain('TaskGraph task 1');
		expect(argv.slice(2)).toEqual(['--dangerously-skip-permissions']);

		// Task 1 committed: worktree, branch and claim stay for review
		expect(byId['1']).toMatchObject({
			state: 'done',
			commits: 1,
			kept: true,
			claimed: true
		});
		expect(fs.existsSync(byId['1'].worktree)).toBe(true);
		expect(git(root, 'log', '-1', '--format=%s', 'taskgraph/task-1')).toBe(
			'work on task-1'
		);
		expect(taskById('1')).toMatchObject({
			status: 'in-progress',
			metadata: { claimedBy: 'tester' }
		});

		// Task 2 failed and task 3 did nothing: removed and released
		expect(byId['2']).toMatchObject({
			state: 'failed',
			error: 'exit 1',
			kept: false,
			claimed: false
		});
		expect(byId['3']).toMatchObject({ state: 'done', kept: false });
		for (const id of ['2', '3']) {
			expect(fs.existsSync(byId[id].worktree)).toBe(false);
			expect(branchExists(`taskgraph/task-${id}`)).toBe(false);
			expect(taskById(id)?.status).toBe('pending');
			expect(taskById(id)?.metadata?.claimedBy).toBeUndefined();
		}

		// Never merged, and the worktrees folder is out of git status
		expect(git(root, 'log', '--format=%s', 'main')).toBe('init');
		expect(git(root, 'status', '--porcelain')).not.toContain('worktrees');
		expect(taskById('4')?.status).toBe('pending');
	}, 60_000);

	it('starts no more than N tasks', async () => {
		writePlan({});

		const result = await tmCore.loop.runParallel({
			parallel: 2,
			trusted: true,
			claimant: 'tester',
			command: fakeClaude()
		});

		expect(result.tasks.map((t) => t.id)).toHaveLength(2);
		expect(result.readyCount).toBe(3);
	}, 60_000);

	it('on abort kills the processes, releases the claims and keeps worktrees with work', async () => {
		writePlan({ 'task-1': 'dirty-sleep', 'task-2': 'sleep' });
		const controller = new AbortController();
		const pidFile = (name: string) => path.join(pidDir, name);

		const running = tmCore.loop.runParallel({
			parallel: 2,
			trusted: true,
			claimant: 'tester',
			command: fakeClaude(),
			signal: controller.signal,
			killGraceMs: 2000
		});
		await vi.waitFor(
			() => {
				expect(fs.existsSync(pidFile('task-1'))).toBe(true);
				expect(fs.existsSync(pidFile('task-2'))).toBe(true);
			},
			{ timeout: 30_000, interval: 50 }
		);
		const pids = ['task-1', 'task-2'].map((n) =>
			Number(fs.readFileSync(pidFile(n), 'utf8'))
		);
		// Both claims are recorded while the processes run
		expect(taskById('1')?.metadata?.claimedBy).toBe('tester');
		expect(taskById('2')?.metadata?.claimedBy).toBe('tester');

		controller.abort();
		const result = await running;

		expect(result.aborted).toBe(true);
		expect(result.tasks.map((t) => t.state)).toEqual(['stopped', 'stopped']);
		for (const pid of pids) expect(isAlive(pid)).toBe(false);
		for (const id of ['1', '2']) {
			expect(taskById(id)?.status).toBe('pending');
			expect(taskById(id)?.metadata?.claimedBy).toBeUndefined();
		}
		const [first, second] = result.tasks;
		expect(first).toMatchObject({
			uncommitted: true,
			kept: true,
			claimed: false
		});
		expect(fs.existsSync(path.join(first.worktree, 'partial.txt'))).toBe(true);
		expect(branchExists('taskgraph/task-1')).toBe(true);
		expect(second).toMatchObject({ kept: false, claimed: false });
		expect(fs.existsSync(second.worktree)).toBe(false);
		expect(branchExists('taskgraph/task-2')).toBe(false);
	}, 60_000);

	it('refuses a dirty tree before claiming anything', async () => {
		writePlan({});
		fs.writeFileSync(path.join(root, 'README.md'), '# changed\n');

		const run = tmCore.loop.runParallel({
			parallel: 2,
			trusted: true,
			claimant: 'tester',
			command: fakeClaude()
		});

		await expect(run).rejects.toBeInstanceOf(ParallelLoopError);
		await expect(run).rejects.toMatchObject({
			message: expect.stringContaining('README.md'),
			hint: expect.stringContaining('git stash')
		});
		expect(readTasks().every((t) => t.status === 'pending')).toBe(true);
		expect(fs.existsSync(path.join(root, '.taskgraph', 'worktrees'))).toBe(
			false
		);
	}, 60_000);

	it("doesn't count TaskGraph's own files as uncommitted work", async () => {
		writePlan({});
		await tmCore.tasks.updateStatus('4', 'deferred');

		const result = await tmCore.loop.runParallel({
			parallel: 1,
			trusted: true,
			claimant: 'tester',
			command: fakeClaude()
		});

		expect(result.tasks).toHaveLength(1);
	}, 60_000);
});
