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

	describe('formatStatus', () => {
		it('should format "all_complete" as green', () => {
			const formatStatus = (loopCommand as any).formatStatus.bind(loopCommand);
			const result = formatStatus('all_complete');
			expect(result).toContain('All tasks complete');
		});

		it('should format "max_iterations" as yellow', () => {
			const formatStatus = (loopCommand as any).formatStatus.bind(loopCommand);
			const result = formatStatus('max_iterations');
			expect(result).toContain('Max iterations reached');
		});

		it('should format "blocked" as red', () => {
			const formatStatus = (loopCommand as any).formatStatus.bind(loopCommand);
			const result = formatStatus('blocked');
			expect(result).toContain('Blocked');
		});

		it('should format "error" as red', () => {
			const formatStatus = (loopCommand as any).formatStatus.bind(loopCommand);
			const result = formatStatus('error');
			expect(result).toContain('Error');
		});
	});
});
