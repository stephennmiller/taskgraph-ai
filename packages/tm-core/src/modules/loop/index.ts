/**
 * @fileoverview Loop module exports
 * Simplified API: LoopDomain (facade), LoopService (logic), Presets (content)
 */

// Domain facade - primary public API
export { LoopDomain } from './loop-domain.js';

// Types
export type {
	LoopPreset,
	LoopConfig,
	LoopIteration,
	LoopResult,
	LoopOutputCallbacks
} from './types.js';

// One named task (loop --id)
export { LoopError } from './loop-task.js';
export type { LoopTask } from './loop-task.js';

// --max-turns and --max-budget-usd
export { parseLoopCaps } from './services/iteration-limits.js';

// Parallel runs (loop --parallel)
export * from './parallel/index.js';

// Presets - content and helpers
export {
	PRESETS,
	PRESET_NAMES,
	TASK_PRESETS,
	getPreset,
	isPreset
} from './presets/index.js';
