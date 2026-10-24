import type { ParallelLoopResult, ParallelTask } from '@tm/core';
import { describe, expect, it } from 'vitest';
import {
	formatParallelHeader,
	formatParallelSummary,
	formatParallelTaskLines
} from './parallel-loop-formatters.js';

const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');

const ROOT = '/repo';
const task = (
	id: string,
	fields: Partial<ParallelTask> = {}
): ParallelTask => ({
	id,
	title: `Task ${id}`,
	branch: `taskgraph/task-${id}`,
	worktree: `${ROOT}/.taskgraph/worktrees/task-${id}`,
	logFile: `${ROOT}/.taskgraph/worktrees/task-${id}.log`,
	state: 'done',
	startedAt: 0,
	durationMs: 63_000,
	...fields
});
const result = (
	tasks: ParallelTask[],
	fields: Partial<ParallelLoopResult> = {}
): ParallelLoopResult => ({
	tasks,
	readyCount: tasks.length,
	skippedIds: [],
	aborted: false,
	...fields
});
const summary = (r: ParallelLoopResult) =>
	strip(formatParallelSummary(r, { projectRoot: ROOT, parallel: 3 }));

describe('formatParallelHeader', () => {
	it('says how many run and where the logs are', () => {
		expect(strip(formatParallelHeader(2, '.taskgraph/worktrees'))).toBe(
			'Running 2 tasks side by side · logs in .taskgraph/worktrees'
		);
		expect(strip(formatParallelHeader(undefined, 'x'))).toBe(
			'Running tasks side by side · logs in x'
		);
	});

	it('stays on one line on a narrow terminal', () => {
		expect(strip(formatParallelHeader(3, '.taskgraph/worktrees', 40))).toBe(
			'Running 3 tasks side by side'
		);
		expect(
			strip(formatParallelHeader(3, '.taskgraph/worktrees', 20)).length
		).toBeLessThanOrEqual(20);
	});
});

describe('task text', () => {
	it('drops escape sequences and control characters from titles and errors', () => {
		const [line] = formatParallelTaskLines([
			task('1', { title: 'Fix\x1b[2J\x1b]0;owned\x07 the\rlogin\x00 API' })
		]).map(strip);
		expect(line).toContain('Fix the login API');
		expect(line).not.toMatch(/[\x00-\x1f]/);

		const out = summary(
			result([task('2', { state: 'failed', error: 'bad\x1b[1A\x1b[2Kref' })])
		);
		expect(out).toContain('failed: badref');
		expect(out).not.toContain('\x1b');
	});
});

describe('formatParallelTaskLines', () => {
	it('gives one aligned line per task, with elapsed time while running', () => {
		const lines = formatParallelTaskLines(
			[
				task('3', { state: 'running', durationMs: undefined, startedAt: 0 }),
				task('12', { state: 'failed' })
			],
			{ now: 12_000 }
		).map(strip);

		expect(lines).toEqual([
			'… 3   running  12s    Task 3',
			'✗ 12  failed   1m 3s  Task 12'
		]);
	});

	it('cuts long titles to fit the width', () => {
		const [line] = formatParallelTaskLines(
			[task('1', { title: 'word '.repeat(40) })],
			{ width: 60 }
		).map(strip);

		expect(line.length).toBeLessThanOrEqual(60);
		expect(line.endsWith('…')).toBe(true);
	});
});

describe('formatParallelSummary', () => {
	it('leads with the result, one row per task, and one next step', () => {
		const out = summary(
			result([
				task('1', { commits: 2, kept: true }),
				task('2', { kept: false }),
				task('3', { state: 'failed', error: 'exit 1', kept: false })
			])
		);

		expect(out.split('\n')).toEqual([
			'✓ 2 of 3 tasks done · 1 failed · 1 branch to review',
			'  1  taskgraph/task-1 · 2 commits',
			'  2  no changes; worktree removed',
			'  3  failed: exit 1 · .taskgraph/worktrees/task-3.log',
			'Next: review with git log -p HEAD..taskgraph/task-1'
		]);
	});

	it('keeps a failed task that left work, and says it failed', () => {
		const out = summary(
			result([
				task('4', {
					state: 'failed',
					error: 'exit 2',
					uncommitted: true,
					kept: true
				})
			])
		);

		expect(out).toContain('✗ 1 task failed · 1 branch to review');
		expect(out).toContain(
			'4  taskgraph/task-4 · uncommitted changes (failed: exit 2)'
		);
	});

	it('on abort says the claims were released and how to resume', () => {
		const out = summary(
			result(
				[
					task('1', { state: 'stopped', uncommitted: true, kept: true }),
					task('2', { state: 'stopped', kept: false })
				],
				{ aborted: true }
			)
		);

		expect(out.split('\n')[0]).toBe(
			'Stopped 2 tasks; claims released, 1 worktree with work kept'
		);
		expect(out).toContain(
			'Next: taskgraph loop --parallel 3 picks up where they left off'
		);
	});

	it('on abort keeps --container in the resume command, so the rerun reuses the clones', () => {
		const aborted = result([task('1', { state: 'stopped', kept: true })], {
			aborted: true
		});
		const resume = (container: { image?: string }) =>
			strip(
				formatParallelSummary(aborted, {
					projectRoot: ROOT,
					parallel: 3,
					container
				})
			);

		expect(resume({})).toContain(
			'Next: taskgraph loop --parallel 3 --container picks up where they left off'
		);
		expect(resume({ image: 'my-img:1' })).toContain(
			'taskgraph loop --parallel 3 --container --container-image my-img:1'
		);
	});

	it('says when nothing is ready', () => {
		expect(summary(result([]))).toBe(
			'No tasks are ready to run\nRun taskgraph graph to see what the rest wait on'
		);
	});

	it('fits 80 columns for typical output', () => {
		const out = summary(
			result([task('100', { commits: 12, uncommitted: true, kept: true })])
		);
		for (const line of out.split('\n')) {
			expect(line.length).toBeLessThanOrEqual(80);
		}
	});
});
