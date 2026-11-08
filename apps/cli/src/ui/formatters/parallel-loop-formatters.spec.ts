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
	heldBackIds: [],
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
			result([
				task('2', {
					state: 'failed',
					error: 'bad\x1b[1A\x1b[2Kref',
					outcome: 'failed'
				})
			])
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
				task('1', { commits: 2, outcome: 'kept', finished: true }),
				task('2', { outcome: 'no-changes', finished: true }),
				task('3', { state: 'failed', error: 'exit 1', outcome: 'failed' })
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

	it('names the tasks held back because they edit the same files (#952)', () => {
		const out = summary(
			result([task('1', { commits: 1, outcome: 'kept', finished: true })], {
				heldBackIds: ['2', '4']
			})
		);

		expect(out.split('\n').slice(2)).toEqual([
			'Held back 2, 4: they edit files a task above edits; the next run takes them',
			'Next: review with git log -p HEAD..taskgraph/task-1'
		]);
	});

	it('adds what each task and the run spent', () => {
		const out = summary(
			result(
				[
					task('1', {
						commits: 1,
						outcome: 'kept',
						finished: true,
						costUsd: 0.72,
						turns: 31
					}),
					task('2', { outcome: 'no-changes' })
				],
				{ totalCostUsd: 0.72 }
			)
		);

		expect(out.split('\n').slice(0, 3)).toEqual([
			'✓ 1 of 2 tasks done · 1 branch to review · $0.72',
			'  1  taskgraph/task-1 · 1 commit · $0.72 · 31 turns',
			'  2  no changes; worktree removed'
		]);
	});

	it("says when a task's cost is unknown and the run's total leaves it out (#861)", () => {
		const out = summary(
			result(
				[
					task('1', {
						commits: 1,
						outcome: 'kept',
						finished: true,
						costUsd: 0.72
					}),
					task('2', { outcome: 'no-changes', costUnknown: true })
				],
				{ totalCostUsd: 0.72, costPartial: true }
			)
		);

		expect(out.split('\n').slice(0, 3)).toEqual([
			'✓ 1 of 2 tasks done · 1 branch to review · at least $0.72',
			'  1  taskgraph/task-1 · 1 commit · $0.72',
			'  2  no changes; worktree removed · cost unknown'
		]);
	});

	it('says "branches" for more than one kept branch', () => {
		const out = summary(
			result([
				task('1', { commits: 1, outcome: 'kept', finished: true }),
				task('2', { commits: 1, outcome: 'kept', finished: true })
			])
		);

		expect(out).toContain('✓ 2 of 2 tasks done · 2 branches to review');
	});

	it("doesn't count a task Claude left unmarked as done", () => {
		const out = summary(result([task('1', { commits: 1, outcome: 'kept' })]));

		expect(out).toContain('✗ 0 of 1 task done · 1 branch to review');
	});

	it('keeps a failed task that left work, and says it failed', () => {
		const out = summary(
			result([
				task('4', {
					state: 'failed',
					error: 'exit 2',
					uncommitted: true,
					outcome: 'released'
				})
			])
		);

		expect(out).toContain('✗ 1 task failed · 1 branch to review');
		expect(out).toContain(
			'4  taskgraph/task-4 · uncommitted changes (failed: exit 2; worktree kept, claim released)'
		);
	});

	it('keeps quiet about the claim when the failed task is still claimed', () => {
		const out = summary(
			result([
				task('4', {
					state: 'failed',
					error: 'stuck',
					commits: 1,
					outcome: 'failed-kept'
				})
			])
		);

		expect(out).toContain('4  taskgraph/task-4 · 1 commit (failed: stuck)');
	});

	it('on abort says the claims were released and how to resume', () => {
		const out = summary(
			result(
				[
					task('1', {
						state: 'stopped',
						uncommitted: true,
						outcome: 'stopped'
					}),
					task('2', { state: 'stopped', outcome: 'no-changes' })
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
		const aborted = result(
			[task('1', { state: 'stopped', outcome: 'stopped' })],
			{
				aborted: true
			}
		);
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

	it('with --merge, says what merged in how many waves (#973)', () => {
		const out = summary(
			result(
				[
					task('1', { finished: true, outcome: 'merged', commits: 2 }),
					task('2', { finished: true, outcome: 'merged', commits: 1 })
				],
				{ waves: 2 }
			)
		);

		expect(out.split('\n')).toEqual([
			'✓ 2 of 2 tasks done · 2 merged in 2 waves',
			'  1  merged taskgraph/task-1 · 2 commits',
			'  2  merged taskgraph/task-2 · 1 commit'
		]);
	});

	it('with --merge, names the branch that conflicted and the tasks left in review', () => {
		const out = summary(
			result(
				[
					task('1', { finished: true, outcome: 'merged', commits: 1 }),
					task('2', { finished: true, outcome: 'conflict', commits: 1 }),
					task('3', {
						finished: true,
						outcome: 'set-aside',
						setAsideAs: 'taskgraph/task-3-conflict-1'
					})
				],
				{ waves: 1, conflictBranch: 'taskgraph/task-2', notDoneIds: ['1'] }
			)
		);

		expect(out).toContain('Merged but not done (unchecked criteria): 1');
		expect(out).toContain(
			'3  conflicted; work kept on taskgraph/task-3-conflict-1, task back to pending'
		);
		expect(out.split('\n').at(-1)).toBe(
			'Next: git merge taskgraph/task-2 conflicts; resolve it, then run taskgraph loop --parallel 3 --merge again'
		);
	});

	it('with --merge, says which finished tasks it left unmerged and why (#1012, #1013)', () => {
		const out = summary(
			result(
				[
					task('1', { finished: true, outcome: 'unmerged', uncommitted: true }),
					task('2', {
						state: 'failed',
						error: 'exit 1',
						outcome: 'released',
						commits: 1,
						status: 'review'
					}),
					task('3', { finished: true, outcome: 'conflict', commits: 1 })
				],
				{ waves: 1, unmergedIds: ['1', '2', '3'] }
			)
		);

		expect(out).toContain(
			'Not merged, so tasks that depend on them wait: 1 (uncommitted changes in .taskgraph/worktrees/task-1), 2 (Claude Code failed after setting it to review), 3 (taskgraph/task-3 conflicts)'
		);
	});

	it('with --merge, lists the stuck tasks it set aside and how to retry them (#1002)', () => {
		const reason = 'stuck: 3 failed sessions in a row. Last error: exit 1';
		const out = summary(
			result(
				[
					task('1', { finished: true, outcome: 'merged', commits: 1 }),
					task('9', { state: 'failed', error: 'exit 1', outcome: 'failed' })
				],
				{ waves: 3, setAside: [{ id: '9', reason }] }
			)
		);

		expect(out.split('\n').slice(-3)).toEqual([
			'Set aside 1 stuck task as blocked',
			`  9  ${reason}`,
			'Next: taskgraph show 9, then taskgraph set-status --id=9 --status=pending'
		]);
	});

	it('puts the set-aside hint after the Next: line as Then:, not a second Next:', () => {
		const reason = 'stuck: 3 failed sessions in a row. Last error: exit 1';
		const out = summary(
			result(
				[
					task('1', { finished: true, outcome: 'kept', commits: 1 }),
					task('9', { state: 'failed', error: 'exit 1', outcome: 'failed' })
				],
				{ waves: 3, setAside: [{ id: '9', reason }] }
			)
		);

		expect(out.split('\n').slice(-4)).toEqual([
			'Next: review with git log -p HEAD..taskgraph/task-1',
			'Set aside 1 stuck task as blocked',
			`  9  ${reason}`,
			'Then: taskgraph show 9, then taskgraph set-status --id=9 --status=pending'
		]);
	});

	it('with --merge, says why the run stopped early (#1039)', () => {
		const out = summary(
			result([task('1', { finished: true, outcome: 'merged' })], {
				waves: 1,
				errorMessage: 'Approval for this project was withdrawn during the run'
			})
		);

		expect(out.split('\n')[2]).toBe(
			'Approval for this project was withdrawn during the run'
		);
	});

	it('says when nothing is ready', () => {
		expect(summary(result([]))).toBe(
			'No tasks are ready to run\nRun taskgraph graph to see what the rest wait on'
		);
	});

	it('fits 80 columns for typical output', () => {
		const out = summary(
			result([task('100', { commits: 12, uncommitted: true, outcome: 'kept' })])
		);
		for (const line of out.split('\n')) {
			expect(line.length).toBeLessThanOrEqual(80);
		}
	});
});
