/**
 * @fileoverview `loop --parallel --merge` against a real git repository and
 * tasks.json, with the fake Claude Code from loop-parallel-fixture.ts: what
 * becomes of a task Claude set to review without committing its work (#1012)
 * or with nothing to commit (#1013), and of a resolved conflict whose fixes
 * Claude left uncommitted (#1026), and whose cost goes on the task.
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

import { createTmCore, type TmCore } from '../../../src/index.js';
import {
	FAKE_CLAUDE,
	fakeTaskgraph,
	git,
	task
} from './loop-parallel-fixture.js';

describe('loop --parallel --merge', () => {
	let root: string;
	let binDir: string;
	let planFile: string;
	let tmCore: TmCore;

	const status = (id: string) =>
		JSON.parse(
			fs.readFileSync(path.join(root, '.taskgraph/tasks/tasks.json'), 'utf8')
		).master.tasks.find((t: { id: string }) => t.id === id).status;
	const run = (plan: Record<string, string>) => {
		fs.writeFileSync(planFile, JSON.stringify(plan));
		return tmCore.loop.runParallel({
			parallel: 2,
			merge: true,
			trusted: true,
			claimant: 'test',
			command: path.join(binDir, 'claude')
		});
	};

	beforeEach(async () => {
		const base = fs.realpathSync(
			fs.mkdtempSync(path.join(os.tmpdir(), 'tm-loop-merge-'))
		);
		root = path.join(base, 'repo');
		binDir = path.join(base, 'bin');
		planFile = path.join(base, 'plan.json');
		for (const dir of [root, binDir]) fs.mkdirSync(dir);
		fs.writeFileSync(path.join(binDir, 'claude'), FAKE_CLAUDE, { mode: 0o755 });
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
						tasks: [task('1'), task('2'), task('3', ['1']), task('4', ['2'])],
						metadata: { created: new Date().toISOString() }
					}
				},
				null,
				2
			)
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

	it('keeps a task left uncommitted in review, unmerged, and runs none of its dependents (#1012)', async () => {
		const result = await run({
			'task-1': 'merge-uncommitted',
			'task-2': 'merge-commit',
			'task-4': 'merge-commit'
		});

		expect(result.unmergedIds).toEqual(['1']);
		expect(status('1')).toBe('review');
		expect(status('3')).toBe('pending');
		expect(status('4')).toBe('done');
		expect(fs.existsSync(path.join(root, 'work-1.txt'))).toBe(false);
		// The work is still in its worktree
		const one = result.tasks.find((t) => t.id === '1');
		expect(one?.outcome).not.toBe('merged');
		expect(fs.existsSync(path.join(one?.worktree ?? '', 'work-1.txt'))).toBe(
			true
		);
	}, 120_000);

	it('marks a task with nothing to commit done, so its dependents run (#1013)', async () => {
		const result = await run({
			'task-1': 'merge-commit',
			'task-2': 'merge-nothing',
			'task-3': 'merge-commit',
			'task-4': 'merge-commit'
		});

		expect(status('2')).toBe('done');
		expect(status('4')).toBe('done');
		expect(fs.existsSync(path.join(root, 'work-4.txt'))).toBe(true);
		expect(result.unmergedIds).toBeUndefined();
	}, 120_000);

	it("doesn't merge a resolved conflict whose fixes Claude left uncommitted, or mark it done (#1026)", async () => {
		const result = await run({
			'task-1': 'merge-conflict-uncommitted',
			'task-2': 'merge-conflict-uncommitted',
			'task-3': 'merge-commit'
		});

		expect(status('1')).toBe('done');
		expect(result.unmergedIds).toEqual(['2']);
		expect(status('2')).toBe('review');
		expect(status('4')).toBe('pending');
		expect(fs.readFileSync(path.join(root, 'shared.txt'), 'utf8')).toBe('1\n');
		// The fix is still in its worktree
		const two = result.tasks.find((t) => t.id === '2');
		expect(two?.uncommitted).toBe(true);
		expect(
			fs.readFileSync(path.join(two?.worktree ?? '', 'shared.txt'), 'utf8')
		).toBe('both, fixed\n');
	}, 120_000);

	it("puts a conflict resolve's cost on the task's own spend, not as an iteration", async () => {
		const result = await run({
			'task-1': 'merge-conflict-uncommitted',
			'task-2': 'merge-conflict-uncommitted'
		});

		const spend = (id: string) =>
			JSON.parse(
				fs.readFileSync(path.join(root, '.taskgraph/tasks/tasks.json'), 'utf8')
			).master.tasks.find((t: { id: string }) => t.id === id).spend;
		// Each worker reports $0.25; task 2's conflict resolve another $0.50
		expect(result.totalCostUsd).toBe(1);
		expect(spend('1')).toMatchObject({ usd: 0.25, iterations: 1 });
		expect(spend('2')).toMatchObject({ usd: 0.75, iterations: 1 });
	}, 120_000);

	describe('tasks an interrupted run left in review (#1124)', () => {
		/** Stop a --merge run once both workers are done, before anything merges */
		const interruptBeforeMerging = async () => {
			fs.writeFileSync(
				planFile,
				JSON.stringify({ 'task-1': 'merge-commit', 'task-2': 'merge-commit' })
			);
			const controller = new AbortController();
			let ended = 0;
			const result = await tmCore.loop.runParallel({
				parallel: 2,
				merge: true,
				trusted: true,
				claimant: 'test',
				command: path.join(binDir, 'claude'),
				signal: controller.signal,
				callbacks: {
					onTaskEnd: () => {
						if (++ended === 2) controller.abort();
					}
				}
			});
			expect(result.aborted).toBe(true);
			expect([status('1'), status('2')]).toEqual(['review', 'review']);
			expect(fs.existsSync(path.join(root, 'work-1.txt'))).toBe(false);
		};

		it('merges them on the next --merge run and marks them done, without a second worker', async () => {
			await interruptBeforeMerging();
			const started: string[] = [];
			// A worker started for task 1 or 2 again would fail it
			fs.writeFileSync(
				planFile,
				JSON.stringify({
					'task-1': 'fail',
					'task-2': 'fail',
					'task-3': 'merge-commit',
					'task-4': 'merge-commit'
				})
			);

			const result = await tmCore.loop.runParallel({
				parallel: 2,
				merge: true,
				trusted: true,
				claimant: 'test',
				command: path.join(binDir, 'claude'),
				callbacks: { onTaskStart: (t) => started.push(t.id) }
			});

			expect(started.sort()).toEqual(['3', '4']);
			for (const id of ['1', '2', '3', '4']) {
				expect(status(id)).toBe('done');
				expect(fs.existsSync(path.join(root, `work-${id}.txt`))).toBe(true);
			}
			expect(result.tasks.map((t) => [t.id, t.outcome]).sort()).toEqual([
				['1', 'merged'],
				['2', 'merged'],
				['3', 'merged'],
				['4', 'merged']
			]);
			expect(result.leftInReviewIds).toBeUndefined();
			expect(git(root, 'branch', '--list', 'taskgraph/*')).toBe('');
		}, 120_000);

		it('leaves them alone without --merge', async () => {
			await interruptBeforeMerging();
			fs.writeFileSync(planFile, '{}');

			const result = await tmCore.loop.runParallel({
				parallel: 2,
				trusted: true,
				claimant: 'test',
				command: path.join(binDir, 'claude')
			});

			expect(result.tasks).toEqual([]);
			expect([status('1'), status('2')]).toEqual(['review', 'review']);
			expect(fs.existsSync(path.join(root, 'work-1.txt'))).toBe(false);
			expect(git(root, 'branch', '--list', 'taskgraph/*')).toContain(
				'taskgraph/task-1'
			);
		}, 120_000);

		it('leaves a task alone whose Claude Code failed after marking it, as the run that ran it did', async () => {
			const first = await run({
				'task-1': 'merge-commit-fail',
				'task-2': 'merge-nothing'
			});
			expect(first.unmergedIds).toEqual(['1']);

			const result = await run({});

			expect(result.leftInReviewIds).toEqual(['1']);
			expect(status('1')).toBe('review');
			expect(fs.existsSync(path.join(root, 'work-1.txt'))).toBe(false);
			expect(git(root, 'branch', '--list', 'taskgraph/*')).toContain(
				'taskgraph/task-1'
			);
		}, 120_000);

		it('leaves a task alone that another run is still working on', async () => {
			// That run's Claude Code marked both for review before committing anything
			const controller = new AbortController();
			fs.writeFileSync(
				planFile,
				JSON.stringify({
					'task-1': 'review-sleep',
					'task-2': 'review-sleep',
					pidDir: binDir
				})
			);
			const other = tmCore.loop.runParallel({
				parallel: 2,
				trusted: true,
				claimant: 'other',
				command: path.join(binDir, 'claude'),
				signal: controller.signal
			});
			await vi.waitFor(
				() => {
					expect([status('1'), status('2')]).toEqual(['review', 'review']);
					expect(fs.existsSync(path.join(binDir, 'task-2'))).toBe(true);
				},
				{ timeout: 60_000, interval: 50 }
			);

			try {
				const result = await tmCore.loop.runParallel({
					parallel: 2,
					merge: true,
					trusted: true,
					claimant: 'test',
					command: path.join(binDir, 'claude')
				});

				expect(result.leftInReviewIds).toEqual(['1', '2']);
				expect(result.tasks).toEqual([]);
				expect([status('1'), status('2')]).toEqual(['review', 'review']);
				for (const id of ['1', '2']) {
					expect(
						fs.existsSync(path.join(root, `.taskgraph/worktrees/task-${id}`))
					).toBe(true);
				}
			} finally {
				controller.abort();
				await other;
			}
		}, 120_000);

		it('leaves a review task alone, and names it, when it has no branch or its branch moved since the run', async () => {
			await interruptBeforeMerging();
			// Task 1's branch gets a commit no run made; task 2's is deleted
			const worktree = path.join(root, '.taskgraph/worktrees/task-1');
			fs.writeFileSync(path.join(worktree, 'mine.txt'), 'mine\n');
			git(worktree, 'add', 'mine.txt');
			git(worktree, 'commit', '-q', '-m', 'my own commit');
			git(root, 'worktree', 'remove', '.taskgraph/worktrees/task-2');
			git(root, 'branch', '-D', 'taskgraph/task-2');

			const result = await run({});

			expect(result.leftInReviewIds).toEqual(['1', '2']);
			expect(result.tasks).toEqual([]);
			expect([status('1'), status('2')]).toEqual(['review', 'review']);
			expect([status('3'), status('4')]).toEqual(['pending', 'pending']);
			expect(fs.existsSync(path.join(root, 'work-1.txt'))).toBe(false);
			expect(fs.existsSync(path.join(worktree, 'mine.txt'))).toBe(true);
		}, 120_000);
	});
});
