/**
 * @fileoverview Preset exports for loop module
 * Simple re-exports from individual preset files with helper functions
 */

import { DEFAULT_PRESET } from './default.js';
import { TEST_COVERAGE_PRESET } from './test-coverage.js';
import { LINTING_PRESET } from './linting.js';
import { DUPLICATION_PRESET } from './duplication.js';
import { ENTROPY_PRESET } from './entropy.js';
import { TDD_PRESET } from './tdd.js';
import type { LoopPreset } from '../types.js';

/**
 * Record of all preset names to their content
 */
export const PRESETS: Record<LoopPreset, string> = {
	default: DEFAULT_PRESET,
	'test-coverage': TEST_COVERAGE_PRESET,
	linting: LINTING_PRESET,
	duplication: DUPLICATION_PRESET,
	entropy: ENTROPY_PRESET,
	tdd: TDD_PRESET
};

/**
 * Array of all available preset names
 */
export const PRESET_NAMES = Object.keys(PRESETS) as LoopPreset[];

/**
 * Presets that work on TaskGraph tasks, so `loop --id` can pin one.
 * The others (test-coverage, linting...) pick their own work.
 */
export const TASK_PRESETS: readonly LoopPreset[] = ['default', 'tdd'];

/**
 * Get the content of a preset by name
 * @param name - The preset name
 * @returns The preset content string
 */
export function getPreset(name: LoopPreset): string {
	return PRESETS[name];
}

/**
 * Type guard to check if a value is a valid preset name
 * @param value - The value to check
 * @returns True if the value is a valid LoopPreset
 */
export function isPreset(value: string): value is LoopPreset {
	// Own keys only: `in` would also match `toString`, `constructor`...
	return Object.hasOwn(PRESETS, value);
}

// Re-export individual presets for direct access
export { DEFAULT_PRESET } from './default.js';
export { TEST_COVERAGE_PRESET } from './test-coverage.js';
export { LINTING_PRESET } from './linting.js';
export { DUPLICATION_PRESET } from './duplication.js';
export { ENTROPY_PRESET } from './entropy.js';
export { TDD_PRESET } from './tdd.js';
