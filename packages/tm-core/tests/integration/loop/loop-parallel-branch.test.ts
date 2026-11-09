/**
 * @fileoverview `loop --parallel` with a `taskgraph/task-<id>` branch that's
 * already in the repository: picked up again only at the starting commit or
 * where the last run left it. Real git and tasks.json, fake Claude Code.
 *
 * @integration
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getLogger } from '../../../src/common/logger/index.js';

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

import { createTmCore, type TmCore } from '../../../src/index.js';
import { FAKE_CLAUDE, git, isAlive, task } from './loop-parallel-fixture.js';

describe('loop --parallel with an existing task branch', () => {
	let root: string;
	let planFile: string;
	let pidDir: string;
	let tmCore: TmCore;
	const fakeClaude = () => path.join(path.dirname(root), 'claude');
	const taskById = (id: string) =>
		(
			JSON.parse(
				fs.readFileSync(
					path.join(root, '.taskgraph', 'tasks', 'tasks.json'),
					'utf8'
				)
			).master.tasks as Array<{
				id: string;
				status: string;
				metadata?: Record<string, number>;
			}>
		).find((t) => t.id === id);
	const writePlan = (plan: Record<string, string>) =>
		fs.writeFileSync(planFile, JSON.stringify({ ...plan, pidDir }));
	const record = (branch: string) =>
		path.join(root, '.git', 'taskgraph', 'branches', branch);
	const commitFile = (cwd: string, file: string, branch?: string) => {
		if (branch) git(cwd, 'checkout', '-q', '-b', branch);
		fs.mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true });
		fs.writeFileSync(path.join(cwd, file), 'Other content\n');
		git(cwd, 'add', file);
		git(cwd, 'commit', '-qm', `change ${file}`);
		if (branch) git(cwd, 'checkout', '-q', 'main');
	};
	const options = (claimant: string) => ({
		parallel: 2,
		trusted: true,
		claimant,
		command: fakeClaude()
	});

	beforeEach(async () => {
		const base = fs.realpathSync(
			fs.mkdtempSync(path.join(os.tmpdir(), 'tm-loop-branch-'))
		);
		root = path.join(base, 'repo');
		planFile = path.join(base, 'plan.json');
		pidDir = path.join(base, 'pids');
		fs.mkdirSync(pidDir);
		fs.mkdirSync(path.join(root, '.taskgraph', 'tasks'), { recursive: true });
		fs.writeFileSync(fakeClaude(), FAKE_CLAUDE, { mode: 0o755 });
		vi.stubEnv('FAKE_CLAUDE_PLAN', planFile);
		fs.writeFileSync(
			path.join(root, '.taskgraph', 'tasks', 'tasks.json'),
			JSON.stringify({ master: { tasks: [task('1')], metadata: {} } })
		);
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
		vi.mocked(getLogger().warn).mockClear();
		for (const name of fs.readdirSync(pidDir)) {
			const pid = Number(fs.readFileSync(path.join(pidDir, name), 'utf8'));
			if (isAlive(pid)) process.kill(pid, 'SIGKILL');
		}
		await tmCore?.close();
		fs.rmSync(path.dirname(root), { recursive: true, force: true });
	});

	it("doesn't start Claude on a task branch that was already here with other commits", async () => {
		writePlan({ 'task-1': 'commit' });
		// Any commit no run recorded, even one that changes no file Claude Code loads
		commitFile(root, 'src/app.ts', 'taskgraph/task-1');

		const [result] = (
			await tmCore.loop.runParallel({
				parallel: 1,
				trusted: true,
				claimant: 'tester',
				command: fakeClaude()
			})
		).tasks;

		expect(result).toMatchObject({ state: 'failed', claimed: false });
		expect(result.error).toContain('taskgraph/task-1 already exists');
		expect(result.error).toMatch(/git diff \w+ taskgraph\/task-1/);
		expect(result.error).toContain('git branch -m taskgraph/task-1');
		expect(result.error).toContain('git branch -D taskgraph/task-1');
		expect(fs.existsSync(result.worktree)).toBe(false);
		expect(fs.existsSync(result.logFile)).toBe(false);
		expect(taskById('1')?.status).toBe('pending');
	}, 60_000);

	it('picks up a task branch at the starting commit or where the last run left it, not after it moves', async () => {
		git(root, 'branch', 'taskgraph/task-1');
		writePlan({ 'task-1': 'commit-fail' });
		const options = { parallel: 1, trusted: true, command: fakeClaude() };

		const [first] = (
			await tmCore.loop.runParallel({ ...options, claimant: 'a' })
		).tasks;
		expect(first).toMatchObject({
			state: 'failed',
			commits: 1,
			outcome: 'released'
		});

		// The kept worktree is picked up again, Claude's commit and all
		const [second] = (
			await tmCore.loop.runParallel({ ...options, claimant: 'b' })
		).tasks;
		expect(second).toMatchObject({
			error: 'exit 1',
			commits: 1,
			outcome: 'released'
		});

		// Still where the last run left it after main moves on
		commitFile(root, 'src/main.ts');
		const [third] = (
			await tmCore.loop.runParallel({ ...options, claimant: 'c' })
		).tasks;
		expect(third).toMatchObject({
			error: 'exit 1',
			commits: 1,
			outcome: 'released'
		});

		commitFile(third.worktree, 'src/app.ts');
		const [fourth] = (
			await tmCore.loop.runParallel({ ...options, claimant: 'd' })
		).tasks;
		expect(fourth).toMatchObject({
			state: 'failed',
			error: expect.stringContaining('taskgraph/task-1 already exists')
		});
		expect(git(root, 'rev-list', '--count', 'main..taskgraph/task-1')).toBe(
			'2'
		);
	}, 60_000);

	describe('after its run was killed with -9 mid-task', () => {
		const crashRun = async () => {
			writePlan({ 'task-1': 'commit-sleep' });
			const script = path.join(path.dirname(root), 'run.mts');
			const core = path.resolve(__dirname, '../../../src/index.ts');
			fs.writeFileSync(
				script,
				`import { createTmCore } from ${JSON.stringify(core)};
const tmCore = await createTmCore({ projectPath: ${JSON.stringify(root)} });
await tmCore.loop.runParallel({ parallel: 1, trusted: true, claimant: 'a', command: ${JSON.stringify(fakeClaude())} });`
			);
			const runner = spawn(
				process.execPath,
				[createRequire(import.meta.url).resolve('tsx/cli'), script],
				{ stdio: 'ignore' }
			);
			// The worker committed and its pid is in the claim: kill the run, then it
			await vi.waitFor(
				() => {
					expect(fs.existsSync(path.join(pidDir, 'task-1'))).toBe(true);
					expect(taskById('1')).toMatchObject({
						metadata: { claimWorkerPid: expect.any(Number) }
					});
				},
				{ timeout: 30_000 }
			);
			// tsx runs the script in a child: the run is the claim's pid
			const { claimPid, claimWorkerPid } = taskById('1')?.metadata ?? {};
			process.kill(claimPid, 'SIGKILL');
			// Gone with its parent, so the dead run isn't left a zombie
			const exited = new Promise((resolve) => runner.once('exit', resolve));
			runner.kill('SIGKILL');
			await exited;
			process.kill(claimWorkerPid, 'SIGKILL');
			for (const pid of [claimPid, claimWorkerPid]) {
				await vi.waitFor(() => expect(isAlive(pid)).toBe(false), {
					timeout: 10_000
				});
			}
			// settle never ran: the record is still the starting commit
			expect(fs.readFileSync(record('taskgraph/task-1'), 'utf8')).toBe(
				git(root, 'rev-parse', 'main')
			);
			writePlan({});
		};

		it('a rerun by the same claimant picks the branch up, the worker commit and all', async () => {
			await crashRun();

			const [result] = (
				await tmCore.loop.runParallel({ ...options('a'), parallel: 1 })
			).tasks;

			expect(result).toMatchObject({
				state: 'done',
				commits: 1,
				outcome: 'kept'
			});
			expect(fs.readFileSync(record('taskgraph/task-1'), 'utf8')).toBe(
				git(root, 'rev-parse', 'taskgraph/task-1')
			);
		}, 90_000);

		it('a rerun by another claimant still refuses the unrecorded commit', async () => {
			await crashRun();

			const [result] = (
				await tmCore.loop.runParallel({ ...options('b'), parallel: 1 })
			).tasks;

			expect(result.state).toBe('failed');
			expect(result.error).toContain('taskgraph/task-1 already exists');
		}, 90_000);

		it('a rerun by the same claimant refuses a branch moved off the record', async () => {
			await crashRun();
			// Unrelated history: none of it built on what the run recorded
			git(root, 'checkout', '-q', '--orphan', 'other');
			commitFile(root, 'src/app.ts');
			git(root, 'checkout', '-q', 'main');
			const worktree = path.join(root, '.taskgraph', 'worktrees', 'task-1');
			git(worktree, 'reset', '-q', '--hard', 'other');

			const [result] = (
				await tmCore.loop.runParallel({ ...options('a'), parallel: 1 })
			).tasks;

			expect(result.state).toBe('failed');
			expect(result.error).toContain('taskgraph/task-1 already exists');
		}, 90_000);
	});

	it('makes the worktree again when its folder was deleted by hand (#1104)', async () => {
		writePlan({ 'task-1': 'commit-fail' });
		const [first] = (await tmCore.loop.runParallel(options('a'))).tasks;
		expect(first).toMatchObject({ commits: 1, outcome: 'released' });
		// Not `git worktree remove`: git still lists the worktree
		fs.rmSync(first.worktree, { recursive: true, force: true });

		const [again] = (await tmCore.loop.runParallel(options('a'))).tasks;

		// Claude ran, in a worktree holding the branch's commit
		expect(again).toMatchObject({ error: 'exit 1', commits: 1 });
		expect(fs.existsSync(path.join(again.worktree, 'work.txt'))).toBe(true);
	}, 60_000);

	it('says the working folder is missing, not that claude is', async () => {
		writePlan({ 'task-1': 'commit' });

		const [result] = (
			await tmCore.loop.runParallel({
				...options('a'),
				spawner: (command, args, spawnOptions) => {
					fs.rmSync(String(spawnOptions.cwd), { recursive: true });
					return spawn(command, args, spawnOptions);
				}
			})
		).tasks;

		expect(result.state).toBe('failed');
		expect(result.error).toBe(
			`The working folder ${result.worktree} is missing`
		);
	}, 60_000);

	it('records where the branch is as soon as its worktree is made, before cleanup', async () => {
		writePlan({ 'task-1': 'sleep' });
		const controller = new AbortController();
		const run = tmCore.loop.runParallel({
			...options('a'),
			signal: controller.signal,
			killGraceMs: 100
		});
		await vi.waitFor(
			() => expect(fs.existsSync(path.join(pidDir, 'task-1'))).toBe(true),
			{ timeout: 20_000 }
		);

		expect(fs.readFileSync(record('taskgraph/task-1'), 'utf8')).toBe(
			git(root, 'rev-parse', 'HEAD')
		);
		controller.abort();
		await run;
	}, 60_000);

	it("cleans up every task when the branch record can't be written", async () => {
		fs.writeFileSync(
			path.join(root, '.taskgraph', 'tasks', 'tasks.json'),
			JSON.stringify({
				master: { tasks: [task('1'), task('2')], metadata: {} }
			})
		);
		// A file where the records' folder goes
		fs.mkdirSync(path.dirname(record('taskgraph')), { recursive: true });
		fs.writeFileSync(record('taskgraph'), '');
		writePlan({});

		const { tasks } = await tmCore.loop.runParallel(options('a'));

		expect(tasks.map((t) => [t.id, t.state, t.outcome])).toEqual([
			['1', 'done', 'no-changes'],
			['2', 'done', 'no-changes']
		]);
		for (const t of tasks) expect(fs.existsSync(t.worktree)).toBe(false);
		expect(taskById('1')?.status).toBe('pending');
		expect(taskById('2')?.status).toBe('pending');
		expect(getLogger().warn).toHaveBeenCalledWith(
			"Couldn't record where taskgraph/task-1 was left:",
			expect.anything()
		);
	}, 60_000);

	it("doesn't let the repository's config start a program for loop's own git calls", async () => {
		const marker = path.join(path.dirname(root), 'fsmonitor-ran');
		const hook = path.join(path.dirname(root), 'fsmonitor.sh');
		fs.writeFileSync(hook, `#!/bin/sh\ntouch '${marker}'\n`, { mode: 0o755 });
		git(root, 'config', 'core.fsmonitor', hook);
		writePlan({});

		const [result] = (await tmCore.loop.runParallel(options('a'))).tasks;

		expect(result).toMatchObject({ state: 'done', outcome: 'no-changes' });
		expect(fs.existsSync(marker)).toBe(false);
	}, 60_000);
});
