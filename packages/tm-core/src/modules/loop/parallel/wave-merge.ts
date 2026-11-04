/**
 * @fileoverview `loop --parallel --merge` (#973): run a wave, merge every
 * finished task's branch into the current branch, mark the task done so its
 * dependents become ready, and run the next wave. A branch that conflicts
 * goes to Claude Code to resolve in its worktree. If that fails, the branch
 * is set aside and its task goes back to pending, so the next wave redoes it
 * on top of what merged; failing again on the same task stops the run.
 * Stops too when a wave merges nothing, the run is aborted, or the budget is
 * spent.
 */

import type {
	ParallelLoopOptions,
	ParallelLoopResult,
	ParallelTask
} from './types.js';

/** What merging needs: TaskWorktrees and the tasks domain in a real run */
export interface WaveMergeDeps {
	runWave: (options: ParallelLoopOptions) => Promise<ParallelLoopResult>;
	merge: (branch: string) => Promise<boolean>;
	/** Have Claude Code resolve a conflicting branch in its worktree, within this budget */
	resolve: (
		task: ParallelTask,
		budgetUsd?: number
	) => Promise<{ ok: boolean; costUsd: number }>;
	remove: (worktree: string, branch: string) => Promise<unknown>;
	/** Mark a merged task done; throws when done is refused (unchecked criteria, smoke check) */
	markDone: (id: string) => Promise<unknown>;
	/**
	 * A branch conflicted: keep its work under another name and put the task
	 * back to pending. Returns that name, or undefined when it couldn't
	 */
	setAside: (
		id: string,
		worktree: string,
		branch: string
	) => Promise<string | undefined>;
}

/** Less than this left and no wave starts, as in the sequential loop (#971) */
const MIN_WAVE_BUDGET_USD = 0.25;

export async function runMergingWaves(
	options: ParallelLoopOptions,
	deps: WaveMergeDeps
): Promise<ParallelLoopResult> {
	const total: ParallelLoopResult = {
		tasks: [],
		readyCount: 0,
		skippedIds: [],
		heldBackIds: [],
		aborted: false,
		waves: 0
	};
	const notDone: string[] = [];
	const conflicted = new Set<string>();
	let spent = 0;
	const resolveAndMerge = async (task: ParallelTask) => {
		const share =
			options.maxBudgetUsd === undefined
				? undefined
				: Math.max(0, options.maxBudgetUsd - spent) / options.parallel;
		const { ok, costUsd } = await deps.resolve(task, share);
		spent += costUsd;
		if (costUsd) total.totalCostUsd = spent;
		return ok && (await deps.merge(task.branch));
	};

	while (!options.signal?.aborted) {
		const left =
			options.maxBudgetUsd === undefined
				? undefined
				: options.maxBudgetUsd - spent;
		if (
			left !== undefined &&
			total.waves &&
			left < Math.min(MIN_WAVE_BUDGET_USD, options.maxBudgetUsd ?? 0)
		) {
			break;
		}
		const wave = await deps.runWave({ ...options, maxBudgetUsd: left });
		if (!total.waves) total.readyCount = wave.readyCount;
		total.waves = (total.waves ?? 0) + 1;
		total.tasks.push(...wave.tasks);
		total.skippedIds = wave.skippedIds;
		total.heldBackIds = wave.heldBackIds;
		total.aborted = wave.aborted;
		if (wave.costPartial) total.costPartial = true;
		if (wave.totalCostUsd !== undefined) {
			spent += wave.totalCostUsd;
			total.totalCostUsd = spent;
		}
		if (wave.aborted) break;

		let merged = 0;
		for (const task of wave.tasks) {
			if (!task.finished || !task.kept) continue;
			if (!(await deps.merge(task.branch)) && !(await resolveAndMerge(task))) {
				const kept =
					!conflicted.has(task.id) &&
					(await deps.setAside(task.id, task.worktree, task.branch));
				if (!kept) {
					total.conflictBranch = task.branch;
					break;
				}
				conflicted.add(task.id);
				task.setAsideAs = kept;
				continue;
			}
			task.merged = true;
			merged++;
			await deps.remove(task.worktree, task.branch);
			await deps.markDone(task.id).catch(() => notDone.push(task.id));
		}
		if (total.conflictBranch || merged === 0) break;
	}

	if (notDone.length) total.notDoneIds = notDone;
	return total;
}
