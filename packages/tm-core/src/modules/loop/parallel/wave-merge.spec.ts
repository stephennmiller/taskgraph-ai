import { describe, expect, it } from 'vitest';
import type {
	ParallelLoopOptions,
	ParallelLoopResult,
	ParallelTask
} from './types.js';
import { TRUST_LOST } from '../loop-trust.js';
import { runMergingWaves } from './wave-merge.js';

const task = (
	id: string,
	fields: Partial<ParallelTask> = {}
): ParallelTask => ({
	id,
	title: `Task ${id}`,
	branch: `taskgraph/task-${id}`,
	worktree: `/repo/.taskgraph/worktrees/task-${id}`,
	logFile: `/repo/.taskgraph/worktrees/task-${id}.log`,
	state: 'done',
	startedAt: 0,
	finished: true,
	outcome: 'kept',
	...fields
});
const wave = (
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

/** Runs the given waves in order, then empty ones; records every call */
function fakeRun(
	waves: ParallelLoopResult[],
	conflicts: string[] = [],
	cantSetAside = false,
	resolves: string[] = [],
	leftUncommitted: string[] = []
) {
	const calls = {
		budgets: [] as (number | undefined)[],
		ran: [] as string[],
		merged: [] as string[],
		removed: [] as string[],
		done: [] as string[],
		setAside: [] as string[],
		resolved: [] as string[],
		blocked: [] as string[],
		notes: [] as string[]
	};
	const fixed = new Set<string>();
	let i = 0;
	return {
		calls,
		deps: {
			runWave: async (o: ParallelLoopOptions) => {
				calls.budgets.push(o.maxBudgetUsd);
				// A blocked task isn't ready, so the runner never claims it
				const next = waves[i++] ?? wave([]);
				const tasks = next.tasks.filter((t) => !calls.blocked.includes(t.id));
				calls.ran.push(...tasks.map((t) => t.id));
				return { ...next, tasks };
			},
			merge: async (branch: string) => {
				if (conflicts.includes(branch) && !fixed.has(branch)) return false;
				calls.merged.push(branch);
				return true;
			},
			remove: async (worktree: string) => {
				calls.removed.push(worktree);
			},
			resolve: async (t: ParallelTask, budgetUsd?: number) => {
				calls.resolved.push(`${t.id}:${budgetUsd}`);
				const ok = resolves.includes(t.branch);
				if (ok) fixed.add(t.branch);
				return {
					ok,
					costUsd: 0.1,
					uncommitted: leftUncommitted.includes(t.branch)
				};
			},
			setAside: async (id: string, _worktree: string, branch: string) => {
				if (cantSetAside) return undefined;
				calls.setAside.push(id);
				return `${branch}-conflict-1`;
			},
			markDone: async (id: string) => {
				if (id === 'refused') throw new Error('criteria unchecked');
				calls.done.push(id);
			},
			block: async (id: string, note: string) => {
				calls.blocked.push(id);
				calls.notes.push(note);
			},
			keepTrust: () => true
		}
	};
}

describe('runMergingWaves', () => {
	it('merges each finished task, marks it done and runs the next wave until nothing is ready', async () => {
		const { calls, deps } = fakeRun([
			wave([task('1')]),
			wave([task('2'), task('3')])
		]);

		const result = await runMergingWaves({ parallel: 3 }, deps);

		expect(calls.merged).toEqual([
			'taskgraph/task-1',
			'taskgraph/task-2',
			'taskgraph/task-3'
		]);
		expect(calls.done).toEqual(['1', '2', '3']);
		expect(calls.removed).toHaveLength(3);
		// The third wave found nothing ready
		expect(result.waves).toBe(3);
		expect(result.tasks.map((t) => [t.id, t.outcome])).toEqual([
			['1', 'merged'],
			['2', 'merged'],
			['3', 'merged']
		]);
	});

	it('blocks a task that fails three waves in a row and keeps merging the others', async () => {
		const failing = () =>
			task('9', { state: 'failed', finished: false, error: 'exit 1' });
		const { calls, deps } = fakeRun([
			wave([task('1'), failing()]),
			wave([task('2'), failing()]),
			wave([task('3'), failing()]),
			wave([task('4'), failing()])
		]);

		const result = await runMergingWaves({ parallel: 2 }, deps);

		expect(calls.blocked).toEqual(['9']);
		expect(calls.notes).toEqual([
			'stuck: 3 failed sessions in a row. Last error: exit 1'
		]);
		// Not run in the fourth wave, which still merged task 4
		expect(calls.ran.filter((id) => id === '9')).toHaveLength(3);
		expect(calls.merged).toContain('taskgraph/task-4');
		expect(result.setAside).toEqual([{ id: '9', reason: calls.notes[0] }]);
	});

	it('never counts a failed wave that committed, only ones that added nothing', async () => {
		const failing = (commits: number) =>
			task('9', {
				state: 'failed',
				finished: false,
				commits,
				outcome: 'released'
			});
		const { calls, deps } = fakeRun([
			wave([task('1'), failing(1)]),
			wave([task('2'), failing(2)]),
			wave([task('3'), failing(3)]),
			// The same commits as before: no progress, so these count
			wave([task('4'), failing(3)]),
			wave([task('5'), failing(3)]),
			wave([task('6'), failing(3)])
		]);

		await runMergingWaves({ parallel: 2 }, deps);

		expect(calls.blocked).toEqual(['9']);
		expect(calls.ran.filter((id) => id === '9')).toHaveLength(6);
	});

	it('blocks a task with no progress in two waves, but never a claimed one', async () => {
		const idle = () => task('8', { finished: false, outcome: 'no-changes' });
		const kept = () => task('7', { finished: false, claimed: true });
		const { calls, deps } = fakeRun([
			wave([task('1'), idle(), kept()]),
			wave([task('2'), idle(), kept()])
		]);

		const result = await runMergingWaves({ parallel: 3 }, deps);

		expect(calls.blocked).toEqual(['8']);
		expect(result.setAside?.[0].reason).toBe(
			'stuck: no progress in 2 sessions'
		);
	});

	it('leaves an unfinished task unmerged and stops when a wave moves nothing', async () => {
		const { calls, deps } = fakeRun([
			wave([task('1', { finished: false, state: 'failed' })])
		]);

		const result = await runMergingWaves({ parallel: 3 }, deps);

		expect(calls.merged).toEqual([]);
		// Nothing merged, so another wave would do the same
		expect(result.waves).toBe(1);
	});

	it('marks a finished task with no changes done, so its dependents run next wave (#1013)', async () => {
		const { calls, deps } = fakeRun([
			wave([task('2', { outcome: 'no-changes' })]),
			wave([task('4')])
		]);

		const result = await runMergingWaves({ parallel: 3 }, deps);

		expect(calls.merged).toEqual(['taskgraph/task-4']);
		expect(calls.done).toEqual(['2', '4']);
		expect(result.waves).toBe(3);
		expect(result.unmergedIds).toBeUndefined();
	});

	it("doesn't merge or mark done a finished task with uncommitted work (#1012)", async () => {
		const { calls, deps } = fakeRun([
			wave([
				task('1', { uncommitted: true, commits: 0 }),
				task('2', { uncommitted: true, commits: 2 }),
				task('3')
			])
		]);

		const result = await runMergingWaves({ parallel: 3 }, deps);

		expect(calls.merged).toEqual(['taskgraph/task-3']);
		expect(calls.done).toEqual(['3']);
		expect(calls.removed).toEqual(['/repo/.taskgraph/worktrees/task-3']);
		expect(result.unmergedIds).toEqual(['1', '2']);
	});

	it('reports a task whose Claude Code failed after setting review, without merging it (#1013)', async () => {
		const { calls, deps } = fakeRun([
			wave([
				task('5', {
					state: 'failed',
					finished: false,
					commits: 1,
					status: 'review'
				})
			])
		]);

		const result = await runMergingWaves({ parallel: 3 }, deps);

		expect(calls.merged).toEqual([]);
		expect(result.unmergedIds).toEqual(['5']);
	});

	it("keeps only each task's latest attempt, so a task that failed and then merged isn't failed", async () => {
		const { deps } = fakeRun([
			wave([task('1'), task('9', { state: 'failed', finished: false })]),
			wave([task('9')])
		]);

		const result = await runMergingWaves({ parallel: 2 }, deps);

		expect(result.tasks.map((t) => [t.id, t.state, t.outcome])).toEqual([
			['1', 'done', 'merged'],
			['9', 'done', 'merged']
		]);
	});

	it('has Claude resolve a conflicting branch, then merges it', async () => {
		const { calls, deps } = fakeRun(
			[wave([task('1'), task('2')], { totalCostUsd: 2 })],
			['taskgraph/task-2'],
			false,
			['taskgraph/task-2']
		);

		const result = await runMergingWaves(
			{ parallel: 2, maxBudgetUsd: 6 },
			deps
		);

		// Its share of what was left: (6 - 2) / 2
		expect(calls.resolved).toEqual(['2:2']);
		expect(calls.merged).toEqual(['taskgraph/task-1', 'taskgraph/task-2']);
		expect(calls.setAside).toEqual([]);
		expect(result.totalCostUsd).toBeCloseTo(2.1);
	});

	it('sets a conflicting branch aside, merges the rest and redoes the task next wave', async () => {
		const { calls, deps } = fakeRun(
			[wave([task('1'), task('2'), task('3')]), wave([task('2')])],
			['taskgraph/task-2']
		);

		const result = await runMergingWaves({ parallel: 3 }, deps);

		expect(calls.merged).toEqual(['taskgraph/task-1', 'taskgraph/task-3']);
		expect(calls.setAside).toEqual(['2']);
		expect(result.tasks[1]).toMatchObject({
			outcome: 'set-aside',
			setAsideAs: 'taskgraph/task-2-conflict-1'
		});
		// The redo conflicted again, so the run stops on it
		expect(result.conflictBranch).toBe('taskgraph/task-2');
		expect(result.waves).toBe(2);
	});

	it("stops at a conflict it can't set aside (uncommitted work) and names the branch", async () => {
		const { calls, deps } = fakeRun(
			[wave([task('1'), task('2'), task('3')])],
			['taskgraph/task-2'],
			true
		);

		const result = await runMergingWaves({ parallel: 3 }, deps);

		expect(calls.merged).toEqual(['taskgraph/task-1', 'taskgraph/task-3']);
		expect(result.conflictBranch).toBe('taskgraph/task-2');
		expect(result.waves).toBe(1);
	});

	it('still merges, marks done or reports the rest of the wave after a conflict that stops the run (#1025)', async () => {
		const { calls, deps } = fakeRun(
			[
				wave([
					task('1'),
					task('2'),
					task('3'),
					task('4', { outcome: 'no-changes' }),
					task('5', { uncommitted: true }),
					task('6')
				])
			],
			['taskgraph/task-2', 'taskgraph/task-6'],
			true
		);

		const result = await runMergingWaves({ parallel: 6 }, deps);

		expect(calls.merged).toEqual(['taskgraph/task-1', 'taskgraph/task-3']);
		expect(calls.done).toEqual(['1', '3', '4']);
		expect(result.conflictBranch).toBe('taskgraph/task-2');
		// A second branch that conflicts is reported, not dropped
		expect(result.unmergedIds).toEqual(['5', '6']);
		expect(result.tasks.map((t) => t.outcome)).toEqual([
			'merged',
			'conflict',
			'merged',
			'no-changes',
			'unmerged',
			'conflict'
		]);
		expect(result.waves).toBe(1);
	});

	it("doesn't merge a resolved branch whose worktree has uncommitted changes, and reports it (#1026)", async () => {
		const { calls, deps } = fakeRun(
			[wave([task('1'), task('2')])],
			['taskgraph/task-2'],
			false,
			['taskgraph/task-2'],
			['taskgraph/task-2']
		);

		const result = await runMergingWaves({ parallel: 2 }, deps);

		expect(calls.merged).toEqual(['taskgraph/task-1']);
		expect(calls.done).toEqual(['1']);
		expect(calls.removed).toEqual(['/repo/.taskgraph/worktrees/task-1']);
		expect(result.unmergedIds).toEqual(['2']);
		expect(result.tasks[1].uncommitted).toBe(true);
		expect(result.conflictBranch).toBeUndefined();
	});

	it('keeps going when done is refused, and lists the task', async () => {
		const { deps } = fakeRun([wave([task('refused'), task('2')])]);

		const result = await runMergingWaves({ parallel: 3 }, deps);

		expect(result.notDoneIds).toEqual(['refused']);
		expect(result.waves).toBe(2);
	});

	it('gives each wave what is left of the budget and stops under $0.25', async () => {
		const { calls, deps } = fakeRun([
			wave([task('1')], { totalCostUsd: 3 }),
			wave([task('2')], { totalCostUsd: 1.8 })
		]);

		const result = await runMergingWaves(
			{ parallel: 3, maxBudgetUsd: 5 },
			deps
		);

		expect(calls.budgets).toEqual([5, 2]);
		expect(result.totalCostUsd).toBeCloseTo(4.8);
		expect(result.waves).toBe(2);
	});

	it('charges a worker killed before it reported a cost the share it was capped at (#1014)', async () => {
		const killed = (commits: number) =>
			task('9', {
				state: 'failed',
				finished: false,
				costUnknown: true,
				commits
			});
		const { calls, deps } = fakeRun([
			wave([task('1'), killed(1)], { costPartial: true }),
			wave([task('2'), killed(2)], { costPartial: true })
		]);

		const result = await runMergingWaves(
			{ parallel: 2, maxBudgetUsd: 10 },
			deps
		);

		// Each wave's killed worker had half of what was left
		expect(calls.budgets).toEqual([10, 5, 2.5]);
		expect(result.totalCostUsd).toBeCloseTo(7.5);
		expect(result.costPartial).toBe(true);
	});

	it('stops when a killed worker leaves under $0.25 of the budget (#1014)', async () => {
		const killed = () =>
			task('9', { state: 'failed', finished: false, costUnknown: true });
		const { calls, deps } = fakeRun([
			wave([task('1'), killed()], { costPartial: true }),
			wave([task('2'), killed()], { costPartial: true })
		]);

		await runMergingWaves({ parallel: 1, maxBudgetUsd: 1 }, deps);

		expect(calls.budgets).toEqual([1]);
	});

	it('stops after an aborted wave without merging it', async () => {
		const { calls, deps } = fakeRun([wave([task('1')], { aborted: true })]);

		const result = await runMergingWaves({ parallel: 3 }, deps);

		expect(calls.merged).toEqual([]);
		expect(result.aborted).toBe(true);
	});

	it('stops before the next wave once the approval is withdrawn (#1039)', async () => {
		const { calls, deps } = fakeRun([wave([task('1')]), wave([task('2')])]);
		let waves = 0;
		deps.keepTrust = () => waves++ < 1;

		const result = await runMergingWaves({ parallel: 2 }, deps);

		expect(calls.ran).toEqual(['1']);
		expect(result.errorMessage).toBe(TRUST_LOST);
	});

	it('merges nothing more and starts no resolve after an abort mid-merge (#1039)', async () => {
		const controller = new AbortController();
		const { calls, deps } = fakeRun(
			[wave([task('1'), task('2'), task('3')])],
			['taskgraph/task-2']
		);
		const merge = deps.merge;
		deps.merge = async (branch) => {
			const ok = await merge(branch);
			// Ctrl-C lands while task 1 merges; task 2 would conflict
			controller.abort();
			return ok;
		};

		const result = await runMergingWaves(
			{ parallel: 3, signal: controller.signal },
			deps
		);

		expect(calls.merged).toEqual(['taskgraph/task-1']);
		expect(calls.resolved).toEqual([]);
		expect(calls.setAside).toEqual([]);
		expect(result.aborted).toBe(true);
		expect(result.waves).toBe(1);
	});

	it('reports the run aborted when the abort lands after the merges (#1039)', async () => {
		const controller = new AbortController();
		const idle = () => task('8', { finished: false, outcome: 'no-changes' });
		const { deps } = fakeRun([
			wave([task('1'), idle()]),
			wave([task('2'), idle()])
		]);
		const block = deps.block;
		deps.block = async (id, note) => {
			await block(id, note);
			// Ctrl-C lands while the stuck task is set to blocked
			controller.abort();
		};

		const result = await runMergingWaves(
			{ parallel: 2, signal: controller.signal },
			deps
		);

		expect(result.aborted).toBe(true);
	});

	it("doesn't set a branch aside when the abort lands during its resolve (#1039)", async () => {
		const controller = new AbortController();
		const { calls, deps } = fakeRun([wave([task('1')])], ['taskgraph/task-1']);
		deps.resolve = async () => {
			controller.abort();
			return { ok: false, costUsd: 0.1, uncommitted: false };
		};

		const result = await runMergingWaves(
			{ parallel: 1, signal: controller.signal },
			deps
		);

		expect(calls.setAside).toEqual([]);
		expect(result.aborted).toBe(true);
	});
});
