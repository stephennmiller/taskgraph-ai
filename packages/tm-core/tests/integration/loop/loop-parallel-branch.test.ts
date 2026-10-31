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
import { FAKE_CLAUDE, git, task } from './loop-parallel-fixture.js';

describe('loop --parallel with an existing task branch', () => {
	let root: string;
	let planFile: string;
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
		fs.writeFileSync(planFile, JSON.stringify(plan));

	beforeEach(async () => {
		const base = fs.realpathSync(
			fs.mkdtempSync(path.join(os.tmpdir(), 'tm-loop-branch-'))
		);
		root = path.join(base, 'repo');
		planFile = path.join(base, 'plan.json');
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
		await tmCore?.close();
		fs.rmSync(path.dirname(root), { recursive: true, force: true });
	});

	it("doesn't start Claude on a task branch that was already here with other commits", async () => {
		writePlan({ 'task-1': 'commit' });
		// What `gh pr checkout` leaves for a pull request from taskgraph/task-1
		git(root, 'checkout', '-q', '-b', 'taskgraph/task-1');
		fs.writeFileSync(path.join(root, 'CLAUDE.md'), 'Other instructions\n');
		git(root, 'add', 'CLAUDE.md');
		git(root, 'commit', '-qm', 'from a pull request');
		git(root, 'checkout', '-q', 'main');

		const [result] = (
			await tmCore.loop.runParallel({
				parallel: 1,
				trusted: true,
				claimant: 'tester',
				command: fakeClaude()
			})
		).tasks;

		expect(result).toMatchObject({
			state: 'failed',
			error: expect.stringContaining('git branch -m taskgraph/task-1'),
			claimed: false
		});
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

		git(second.worktree, 'commit', '-q', '--allow-empty', '-m', 'made since');
		const [third] = (
			await tmCore.loop.runParallel({ ...options, claimant: 'c' })
		).tasks;
		expect(third).toMatchObject({
			state: 'failed',
			error: expect.stringContaining('already exists with commits')
		});
		expect(git(root, 'rev-list', '--count', 'main..taskgraph/task-1')).toBe(
			'2'
		);
	}, 60_000);
});
