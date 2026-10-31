/**
 * @fileoverview `loop --parallel` with a `taskgraph/task-<id>` branch that's
 * already in the repository: picked up again only at the starting commit or
 * where the last run left it. Real git and tasks.json, fake Claude Code.
 *
 * @integration
 */

import fs from 'node:fs';
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
			).master.tasks as Array<{ id: string; status: string }>
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
		expect(first).toMatchObject({ state: 'failed', commits: 1, kept: true });

		// The kept worktree is picked up again, Claude's commit and all
		const [second] = (
			await tmCore.loop.runParallel({ ...options, claimant: 'b' })
		).tasks;
		expect(second).toMatchObject({ error: 'exit 1', commits: 1, kept: true });

		// Still where the last run left it after main moves on
		commitFile(root, 'src/main.ts');
		const [third] = (
			await tmCore.loop.runParallel({ ...options, claimant: 'c' })
		).tasks;
		expect(third).toMatchObject({ error: 'exit 1', commits: 1, kept: true });

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

		expect(tasks.map((t) => [t.id, t.state, t.kept])).toEqual([
			['1', 'done', false],
			['2', 'done', false]
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

		expect(result).toMatchObject({ state: 'done', kept: false });
		expect(fs.existsSync(marker)).toBe(false);
	}, 60_000);
});
