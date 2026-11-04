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
	cantSetAside = false
) {
	const calls = {
		budgets: [] as (number | undefined)[],
		merged: [] as string[],
		removed: [] as string[],
		done: [] as string[],
		setAside: [] as string[]
	};
	let i = 0;
	return {
		calls,
		deps: {
			runWave: async (o: ParallelLoopOptions) => {
				calls.budgets.push(o.maxBudgetUsd);
				return waves[i++] ?? wave([]);
			},
			merge: async (branch: string) => {
				if (conflicts.includes(branch)) return false;
				calls.merged.push(branch);
				return true;
			},
			remove: async (worktree: string) => {
				calls.removed.push(worktree);
			},
			setAside: async (id: string, _worktree: string, branch: string) => {
				if (cantSetAside) return undefined;
				calls.setAside.push(id);
				return `${branch}-conflict-1`;
			},
			markDone: async (id: string) => {
				if (id === 'refused') throw new Error('criteria unchecked');
				calls.done.push(id);
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
