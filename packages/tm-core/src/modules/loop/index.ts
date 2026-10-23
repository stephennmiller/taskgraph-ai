/**
 * @fileoverview Loop module exports
 * Simplified API: LoopDomain (facade), LoopService (logic), Presets (content)
 */

// Domain facade - primary public API
export { LoopDomain } from './loop-domain.js';

// Service - for advanced usage
export { LoopService } from './services/loop.service.js';
export type { LoopServiceOptions } from './services/loop.service.js';

// Types
export type {
	LoopPreset,
	LoopConfig,
	LoopIteration,
	LoopResult,
	LoopOutputCallbacks
} from './types.js';

// One named task (loop --id)
export {
	LoopError,
	assertTaskPreset,
	defaultIterations,
	isTaskPreset
} from './loop-task.js';
export type { LoopTask } from './loop-task.js';

// Parallel runs (loop --parallel)
export * from './parallel/index.js';

// Presets - content and helpers
export {
	PRESETS,
	PRESET_NAMES,
	TASK_PRESETS,
	getPreset,
	isPreset,
	DEFAULT_PRESET,
	TEST_COVERAGE_PRESET,
	LINTING_PRESET,
	DUPLICATION_PRESET,
	ENTROPY_PRESET,
	TDD_PRESET
} from './presets/index.js';
