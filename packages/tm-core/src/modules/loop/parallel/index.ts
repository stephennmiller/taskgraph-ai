/**
 * @fileoverview `loop --parallel` exports
 */

export {
	MAX_PARALLEL,
	TASK_BRANCH_PREFIX,
	ParallelLoopError,
	assertParallelFlags,
	buildParallelPrompt,
	isSafeTaskId,
	parseParallelCount,
	taskBranchName,
	taskLogPath,
	taskWorktreePath,
	worktreesDir
} from './parallel-plan.js';
export type { ParallelFlags } from './parallel-plan.js';
export { ParallelLoopRunner } from './parallel-runner.js';
export {
	TaskWorktrees,
	parsePorcelainPaths,
	parseWorktreeList
} from './task-worktrees.js';
export type { WorktreeWork } from './task-worktrees.js';
export type {
	AgentSpawner,
	ParallelLoopCallbacks,
	ParallelLoopOptions,
	ParallelLoopResult,
	ParallelTask,
	ParallelTaskState
} from './types.js';
