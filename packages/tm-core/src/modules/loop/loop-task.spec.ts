/**
 * @fileoverview Tests for `loop --id` rules: which presets take a task, and
 * how many iterations a run gets by default
 */

import { describe, expect, it } from 'vitest';
import {
	LoopError,
	assertTaskPreset,
	defaultIterations,
	isTaskPreset
} from './loop-task.js';

describe('isTaskPreset', () => {
	it.each(['default', 'tdd'])('is true for %s', (prompt) => {
		expect(isTaskPreset(prompt)).toBe(true);
	});

	it.each(['test-coverage', 'linting', 'duplication', 'entropy', './my.md'])(
		'is false for %s',
		(prompt) => {
			expect(isTaskPreset(prompt)).toBe(false);
		}
	);
});

describe('assertTaskPreset', () => {
	it.each(['default', 'tdd', './my-prompt.md'])('allows %s', (prompt) => {
		expect(() => assertTaskPreset(prompt)).not.toThrow();
	});

	it('refuses a preset that picks its own work, with a fix', () => {
		let error: unknown;
		try {
			assertTaskPreset('linting');
		} catch (e) {
			error = e;
		}
		expect(error).toBeInstanceOf(LoopError);
		expect((error as LoopError).message).toBe(
			"--id can't be combined with the linting preset: it doesn't work on tasks"
		);
		expect((error as LoopError).hint).toBe(
			'Use --prompt default or --prompt tdd, or drop --id'
		);
	});
});

describe('defaultIterations', () => {
	it('is 1 for a pinned task, whatever the preset', () => {
		expect(
			defaultIterations({ preset: 'default', taskId: '3', pendingTaskCount: 9 })
		).toBe(1);
		expect(defaultIterations({ preset: 'tdd', taskId: '3.2' })).toBe(1);
	});

	it('is the pending count for a preset that works on tasks', () => {
		expect(defaultIterations({ preset: 'tdd', pendingTaskCount: 7 })).toBe(7);
		expect(defaultIterations({ preset: 'default', pendingTaskCount: 7 })).toBe(
			7
		);
	});

	it('is 10 otherwise', () => {
		expect(defaultIterations({ preset: 'linting', pendingTaskCount: 7 })).toBe(
			10
		);
		expect(defaultIterations({ preset: 'default', pendingTaskCount: 0 })).toBe(
			10
		);
	});
});
