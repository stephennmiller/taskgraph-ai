/**
 * @fileoverview Unit tests for task ID schemas
 */

import { describe, expect, it } from 'vitest';
import * as taskIdSchemas from './task-id.schema.js';
import { MainTaskIdSchema, TaskIdSchema } from './task-id.schema.js';

describe('TaskIdSchema', () => {
	describe('valid IDs', () => {
		it('should accept numeric main task IDs', () => {
			expect(TaskIdSchema.safeParse('1').success).toBe(true);
			expect(TaskIdSchema.safeParse('123').success).toBe(true);
		});

		it('should accept numeric subtask IDs', () => {
			expect(TaskIdSchema.safeParse('1.1').success).toBe(true);
			expect(TaskIdSchema.safeParse('123.45').success).toBe(true);
		});

		it('should trim whitespace', () => {
			const result = TaskIdSchema.safeParse('  1  ');
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data).toBe('1');
			}
		});
	});

	describe('invalid IDs', () => {
		it('should reject sub-subtasks', () => {
			expect(TaskIdSchema.safeParse('1.2.3').success).toBe(false);
			expect(TaskIdSchema.safeParse('1.2.3.4').success).toBe(false);
		});

		it('should reject prefixed IDs', () => {
			expect(TaskIdSchema.safeParse('HAM-1').success).toBe(false);
			expect(TaskIdSchema.safeParse('ham-1').success).toBe(false);
			expect(TaskIdSchema.safeParse('HAM1').success).toBe(false);
			expect(TaskIdSchema.safeParse('ham1').success).toBe(false);
			expect(TaskIdSchema.safeParse('HAM-1.2').success).toBe(false);
		});

		it('should reject empty and non-numeric input', () => {
			expect(TaskIdSchema.safeParse('').success).toBe(false);
			expect(TaskIdSchema.safeParse('   ').success).toBe(false);
			expect(TaskIdSchema.safeParse('abc').success).toBe(false);
		});
	});

	it('should not export the display ID normalizer or the MCP-only variants', () => {
		expect('normalizeDisplayId' in taskIdSchemas).toBe(false);
		expect('TaskIdSchemaForMcp' in taskIdSchemas).toBe(false);
		expect('MainTaskIdSchemaForMcp' in taskIdSchemas).toBe(false);
	});
});

describe('MainTaskIdSchema', () => {
	describe('valid main tasks', () => {
		it('should accept numeric main task IDs', () => {
			expect(MainTaskIdSchema.safeParse('1').success).toBe(true);
			expect(MainTaskIdSchema.safeParse('123').success).toBe(true);
		});
	});

	describe('invalid IDs', () => {
		it('should reject numeric subtask IDs', () => {
			const result = MainTaskIdSchema.safeParse('1.2');
			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error.issues[0].message).toContain('Subtask');
			}
		});

		it('should reject prefixed IDs', () => {
			expect(MainTaskIdSchema.safeParse('HAM-1').success).toBe(false);
			expect(MainTaskIdSchema.safeParse('ham-1').success).toBe(false);
			expect(MainTaskIdSchema.safeParse('ham1').success).toBe(false);
		});
	});

	describe('error messages', () => {
		it('should provide helpful error for invalid format', () => {
			const result = MainTaskIdSchema.safeParse('invalid');
			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error.issues[0].message).toContain('Invalid task ID');
			}
		});
	});
});
