/**
 * @fileoverview `loop --parallel` exports
 */

export {
	MAX_PARALLEL,
	ParallelLoopError,
	assertParallelFlags,
	parseParallelCount
} from './parallel-plan.js';
export type {
	ParallelLoopCallbacks,
	ParallelLoopOptions,
	ParallelLoopResult,
	ParallelTask,
	ParallelTaskState
} from './types.js';
