/**
 * @fileoverview `loop --parallel` against a real git repository and a real
 * tasks.json, with Claude Code replaced at the process boundary by a fake
 * executable. The fake does what a plan file says for its worktree: commit,
 * fail, do nothing, sleep until it's killed, or work the task the way the
 * prompt says (`review`): `taskgraph show`, commit, `taskgraph set-status`.
 * Its `taskgraph` is a stand-in that resolves the project the way the CLI
 * does (resolveProjectRoot) and then calls tm-core.
 *
 * @integration
 */

import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
	createTmCore,
	ParallelLoopError,
	type ParallelTask,
	type TmCore
} from '../../../src/index.js';
import { TaskWorktrees } from '../../../src/modules/loop/parallel/task-worktrees.js';

import {
	FAKE_CLAUDE,
	fakeTaskgraph,
	git,
	isAlive,
	task
} from './loop-parallel-fixture.js';

describe('loop --parallel', () => {
	let root: string;
	let binDir: string;
	let pidDir: string;
	let planFile: string;
	let tmCore: TmCore;
	const fakeClaude = () => path.join(binDir, 'claude');

	const tasksFile = (dir: string) =>
		path.join(dir, '.taskgraph', 'tasks', 'tasks.json');
	const readTasks = (dir = root) =>
		JSON.parse(fs.readFileSync(tasksFile(dir), 'utf8')).master.tasks as Array<{
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
		const taskgraphScript = path.join(binDir, 'taskgraph.mts');
		fs.writeFileSync(
			taskgraphScript,
			fakeTaskgraph(
				fileURLToPath(new URL('../../../src/index.ts', import.meta.url))
			)
		);
		vi.stubEnv('FAKE_TASKGRAPH', taskgraphScript);
		vi.stubEnv('FAKE_TSX', createRequire(import.meta.url).resolve('tsx/cli'));

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
		// A title that looks like flags must not reach Claude's command line
		const hostile = '--help --model x $(touch pwned)';
		await tmCore.tasks.modifyTask('1', () => ({ title: hostile }));
		git(root, 'commit', '-qam', 'hostile title');
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
		expect(argv.join(' ')).not.toContain(hostile);

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
		expect(git(root, 'log', '-1', '--format=%s', 'main')).toBe('hostile title');
		expect(git(root, 'status', '--porcelain')).not.toContain('worktrees');
		expect(taskById('4')?.status).toBe('pending');
	}, 60_000);

	it('releases a failed task with work, keeps its worktree, and a rerun retries it', async () => {
		writePlan({ 'task-1': 'commit-fail' });
		const options = { parallel: 1, trusted: true, command: fakeClaude() };

		const [first] = (
			await tmCore.loop.runParallel({ ...options, claimant: 'tester' })
		).tasks;

		expect(first).toMatchObject({
			state: 'failed',
			kept: true,
			claimed: false
		});
		expect(fs.existsSync(first.worktree)).toBe(true);
		expect(taskById('1')?.status).toBe('pending');
		const rerun = await tmCore.loop.runParallel({ ...options, claimant: 'b' });
		expect(rerun.tasks.map((t) => t.id)).toEqual(['1']);
	}, 60_000);

	it('stops a worker past TASKGRAPH_LOOP_TIMEOUT_MS, keeps its work and releases it', async () => {
		writePlan({ 'task-1': 'dirty-sleep' });
		vi.stubEnv('TASKGRAPH_LOOP_TIMEOUT_MS', '1000');

		const [only] = (
			await tmCore.loop.runParallel({
				parallel: 1,
				trusted: true,
				claimant: 'tester',
				command: fakeClaude()
			})
		).tasks;

		expect(only).toMatchObject({
			state: 'failed',
			uncommitted: true,
			kept: true,
			claimed: false
		});
		expect(only.error).toContain('TASKGRAPH_LOOP_TIMEOUT_MS');
		expect(taskById('1')?.status).toBe('pending');
	}, 60_000);

	it("records the task's status in the main project, not in the worktree's copy", async () => {
		writePlan({ 'task-1': 'review' });
		// One left over in the shell must not send Claude to another project
		vi.stubEnv('TASKGRAPH_PROJECT_ROOT', path.join(path.dirname(root), 'nope'));
		const committed = fs.readFileSync(tasksFile(root), 'utf8');

		const result = await tmCore.loop.runParallel({
			parallel: 1,
			trusted: true,
			claimant: 'tester',
			command: fakeClaude()
		});

		const [first] = result.tasks;
		expect(first).toMatchObject({
			id: '1',
			state: 'done',
			commits: 1,
			uncommitted: false,
			kept: true,
			claimed: false
		});
		expect(taskById('1')?.status).toBe('review');
		// The worktree's copy is as committed, and the branch carries only work
		expect(fs.readFileSync(tasksFile(first.worktree), 'utf8')).toBe(committed);
		expect(git(root, 'diff', '--name-only', 'main', 'taskgraph/task-1')).toBe(
			'work.txt'
		);
		// Kept for review, but marked review: the tasks after it still wait
		const tree = await tmCore.tasks.getDependencyTree();
		expect(tree.waves.waves[0]).not.toContain('4');
	}, 120_000);

	it('works on a task that exists only uncommitted in the main project', async () => {
		writePlan({ 'task-5': 'review' });
		const data = JSON.parse(fs.readFileSync(tasksFile(root), 'utf8'));
		data.master.tasks = [
			...data.master.tasks.map((t: { id: string }) => ({
				...t,
				status: 'deferred'
			})),
			task('5')
		];
		fs.writeFileSync(tasksFile(root), JSON.stringify(data, null, 2));
		await tmCore.close();
		tmCore = await createTmCore({ projectPath: root });

		const result = await tmCore.loop.runParallel({
			parallel: 1,
			trusted: true,
			claimant: 'tester',
			command: fakeClaude()
		});

		const [only] = result.tasks;
		expect(only).toMatchObject({ id: '5', state: 'done', kept: true });
		expect(taskById('5')?.status).toBe('review');
		expect(readTasks(only.worktree).map((t) => t.id)).not.toContain('5');
	}, 120_000);

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

	it('counts uncommitted TaskGraph config as uncommitted work', async () => {
		writePlan({});
		fs.writeFileSync(path.join(root, '.taskgraph', 'config.json'), '{}\n');
		git(root, 'add', '.taskgraph/config.json');
		git(root, 'commit', '-qm', 'config');
		fs.writeFileSync(
			path.join(root, '.taskgraph', 'config.json'),
			'{"changed":true}\n'
		);

		await expect(
			tmCore.loop.runParallel({
				parallel: 1,
				trusted: true,
				claimant: 'tester',
				command: fakeClaude()
			})
		).rejects.toMatchObject({
			message: expect.stringContaining('.taskgraph/config.json')
		});
		expect(readTasks().every((t) => t.status === 'pending')).toBe(true);
	}, 60_000);

	it('refuses a worktrees folder that is a symlink', async () => {
		writePlan({});
		const elsewhere = path.join(path.dirname(root), 'elsewhere');
		fs.mkdirSync(elsewhere);
		fs.symlinkSync(elsewhere, path.join(root, '.taskgraph', 'worktrees'));
		git(root, 'add', '.taskgraph/worktrees');
		git(root, 'commit', '-qm', 'planted symlink');

		const result = await tmCore.loop.runParallel({
			parallel: 1,
			trusted: true,
			claimant: 'tester',
			command: fakeClaude()
		});

		expect(result.tasks[0]).toMatchObject({
			state: 'failed',
			error: expect.stringContaining('is a symlink'),
			claimed: false
		});
		expect(fs.readdirSync(elsewhere)).toEqual([]);
		expect(readTasks().every((t) => t.status === 'pending')).toBe(true);
	}, 60_000);

	it("doesn't write Claude's output through a symlinked log", async () => {
		writePlan({});
		const target = path.join(path.dirname(root), 'victim.txt');
		fs.writeFileSync(target, 'original\n');
		const dir = path.join(root, '.taskgraph', 'worktrees');
		fs.mkdirSync(dir);
		for (const id of ['1', '2', '3']) {
			fs.symlinkSync(target, path.join(dir, `task-${id}.log`));
		}

		const result = await tmCore.loop.runParallel({
			parallel: 1,
			trusted: true,
			claimant: 'tester',
			command: fakeClaude()
		});

		expect(result.tasks[0]).toMatchObject({
			state: 'failed',
			error: expect.stringContaining("isn't a plain file")
		});
		expect(fs.readFileSync(target, 'utf8')).toBe('original\n');
	}, 60_000);

	it('excludes the worktrees folder when the project is itself a linked worktree', async () => {
		writePlan({ 'task-1': 'commit' });
		const linked = path.join(path.dirname(root), 'linked');
		git(root, 'worktree', 'add', '-q', linked, '-b', 'linked');
		await tmCore.close();
		tmCore = await createTmCore({ projectPath: linked });

		const result = await tmCore.loop.runParallel({
			parallel: 1,
			trusted: true,
			claimant: 'tester',
			command: fakeClaude()
		});

		expect(result.tasks[0]).toMatchObject({ state: 'done', kept: true });
		expect(
			fs.readFileSync(path.join(root, '.git', 'info', 'exclude'), 'utf8')
		).toContain('/.taskgraph/worktrees/');
		expect(git(linked, 'status', '--porcelain')).not.toContain('worktrees');
	}, 60_000);

	it("doesn't start Claude when the abort lands while a worktree is set up", async () => {
		writePlan({ 'task-1': 'sleep' });
		const controller = new AbortController();
		const projectIn = TaskWorktrees.prototype.projectIn;
		const spy = vi
			.spyOn(TaskWorktrees.prototype, 'projectIn')
			.mockImplementation(async function (this: TaskWorktrees, worktree) {
				const cwd = await projectIn.call(this, worktree);
				controller.abort();
				return cwd;
			});
		const spawner = vi.fn();

		try {
			const result = await tmCore.loop.runParallel({
				parallel: 1,
				trusted: true,
				claimant: 'tester',
				command: fakeClaude(),
				signal: controller.signal,
				spawner
			});

			expect(spawner).not.toHaveBeenCalled();
			expect(result.aborted).toBe(true);
			expect(result.tasks[0]).toMatchObject({
				state: 'stopped',
				claimed: false
			});
		} finally {
			spy.mockRestore();
		}
	}, 60_000);

	it('kills Claude if this process exits mid-run', async () => {
		writePlan({ 'task-1': 'sleep' });
		const controller = new AbortController();
		const before = process.listeners('exit');

		const running = tmCore.loop.runParallel({
			parallel: 1,
			trusted: true,
			claimant: 'tester',
			command: fakeClaude(),
			signal: controller.signal
		});
		const pidFile = path.join(pidDir, 'task-1');
		await vi.waitFor(() => expect(fs.existsSync(pidFile)).toBe(true), {
			timeout: 30_000,
			interval: 50
		});
		const pid = Number(fs.readFileSync(pidFile, 'utf8'));

		// What a second Ctrl-C's process.exit() runs
		const added = process
			.listeners('exit')
			.filter((listener) => !before.includes(listener));
		expect(added).toHaveLength(1);
		(added[0] as () => void)();
		await vi.waitFor(() => expect(isAlive(pid)).toBe(false), {
			timeout: 10_000,
			interval: 50
		});

		controller.abort();
		await running;
		expect(process.listeners('exit')).toEqual(before);
	}, 60_000);
});
