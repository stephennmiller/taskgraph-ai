import { describe, expect, it } from 'vitest';
import type {
	ParallelLoopOptions,
	ParallelLoopResult,
	ParallelTask
} from './types.js';
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
	kept: true,
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
	resolves: string[] = []
) {
	const calls = {
		budgets: [] as (number | undefined)[],
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
				return {
					...next,
					tasks: next.tasks.filter((t) => !calls.blocked.includes(t.id))
				};
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
				return { ok, costUsd: 0.1 };
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
			}
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
		expect(result.tasks.map((t) => [t.id, t.merged])).toEqual([
			['1', true],
			['2', true],
			['3', true]
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
		expect(result.tasks.filter((t) => t.id === '9')).toHaveLength(3);
		expect(calls.merged).toContain('taskgraph/task-4');
		expect(result.setAside).toEqual([{ id: '9', reason: calls.notes[0] }]);
	});

	it('never counts a failed wave that committed, only ones that added nothing', async () => {
		const failing = (commits: number) =>
			task('9', { state: 'failed', finished: false, commits, kept: true });
		const { calls, deps } = fakeRun([
			wave([task('1'), failing(1)]),
			wave([task('2'), failing(2)]),
			wave([task('3'), failing(3)]),
			// The same commits as before: no progress, so these count
			wave([task('4'), failing(3)]),
			wave([task('5'), failing(3)]),
			wave([task('6'), failing(3)])
		]);

		const result = await runMergingWaves({ parallel: 2 }, deps);

		expect(calls.blocked).toEqual(['9']);
		expect(result.tasks.filter((t) => t.id === '9')).toHaveLength(6);
	});

	it('blocks a task with no progress in two waves, but never a claimed one', async () => {
		const idle = () => task('8', { finished: false, kept: false });
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

	it('leaves unfinished and empty tasks unmerged', async () => {
		const { calls, deps } = fakeRun([
			wave([
				task('1', { finished: false, state: 'failed' }),
				task('2', { kept: false })
			])
		]);

		const result = await runMergingWaves({ parallel: 3 }, deps);

		expect(calls.merged).toEqual([]);
		// Nothing merged, so another wave would do the same
		expect(result.waves).toBe(1);
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
		expect(result.tasks[1].setAsideAs).toBe('taskgraph/task-2-conflict-1');
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

		expect(calls.merged).toEqual(['taskgraph/task-1']);
		expect(result.conflictBranch).toBe('taskgraph/task-2');
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

	it('stops after an aborted wave without merging it', async () => {
		const { calls, deps } = fakeRun([wave([task('1')], { aborted: true })]);

		const result = await runMergingWaves({ parallel: 3 }, deps);

		expect(calls.merged).toEqual([]);
		expect(result.aborted).toBe(true);
	});
});
