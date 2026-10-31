/**
 * @fileoverview LoopCommand's iteration-count check and status labels
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { LoopCommand } from './loop.command.js';

describe('LoopCommand helpers', () => {
	let loopCommand: LoopCommand;

	beforeEach(() => {
		loopCommand = new LoopCommand();
	});

	describe('validateIterations', () => {
		it('should throw error for invalid iterations (non-numeric)', () => {
			const validateIterations = (loopCommand as any).validateIterations.bind(
				loopCommand
			);
			expect(() => validateIterations('abc')).toThrow('Invalid iterations');
		});

		it('should throw error for invalid iterations (negative)', () => {
			const validateIterations = (loopCommand as any).validateIterations.bind(
				loopCommand
			);
			expect(() => validateIterations('-5')).toThrow('Invalid iterations');
		});

		it('should throw error for invalid iterations (zero)', () => {
			const validateIterations = (loopCommand as any).validateIterations.bind(
				loopCommand
			);
			expect(() => validateIterations('0')).toThrow('Invalid iterations');
		});

		it('should allow valid iterations', () => {
			const validateIterations = (loopCommand as any).validateIterations.bind(
				loopCommand
			);
			expect(() => validateIterations('5')).not.toThrow();
		});
	});
});
