/**
 * @fileoverview Tests for task ID validation utilities
 */

import { describe, it, expect } from 'vitest';
import {
	TASK_ID_PATTERN,
	isValidTaskIdFormat,
	taskIdSchema,
	taskIdsSchema,
	parseTaskIds,
	extractParentId,
	fullSubtaskId,
	isSubtaskId
} from './task-id.js';

describe('Task ID Validation', () => {
	describe('TASK_ID_PATTERN', () => {
		it('matches simple numeric IDs', () => {
			expect(TASK_ID_PATTERN.test('1')).toBe(true);
			expect(TASK_ID_PATTERN.test('15')).toBe(true);
			expect(TASK_ID_PATTERN.test('999')).toBe(true);
		});

		it('matches subtask IDs', () => {
			expect(TASK_ID_PATTERN.test('1.2')).toBe(true);
			expect(TASK_ID_PATTERN.test('15.3')).toBe(true);
		});

		it('matches sub-subtask IDs', () => {
			expect(TASK_ID_PATTERN.test('1.2.3')).toBe(true);
			expect(TASK_ID_PATTERN.test('15.3.1')).toBe(true);
		});

		it('rejects prefixed IDs', () => {
			expect(TASK_ID_PATTERN.test('HAM-123')).toBe(false);
			expect(TASK_ID_PATTERN.test('PROJ-456')).toBe(false);
			expect(TASK_ID_PATTERN.test('abc-999')).toBe(false);
			expect(TASK_ID_PATTERN.test('ham1')).toBe(false);
			expect(TASK_ID_PATTERN.test('HAM-123.2')).toBe(false);
		});

		it('rejects invalid formats', () => {
			expect(TASK_ID_PATTERN.test('')).toBe(false);
			expect(TASK_ID_PATTERN.test('abc')).toBe(false);
			expect(TASK_ID_PATTERN.test('1.a')).toBe(false);
			expect(TASK_ID_PATTERN.test('.1')).toBe(false);
			expect(TASK_ID_PATTERN.test('1.')).toBe(false);
			expect(TASK_ID_PATTERN.test('HAM')).toBe(false);
			expect(TASK_ID_PATTERN.test('123-HAM')).toBe(false);
		});
	});

	describe('isValidTaskIdFormat', () => {
		it('returns true for valid IDs', () => {
			expect(isValidTaskIdFormat('1')).toBe(true);
			expect(isValidTaskIdFormat('1.2')).toBe(true);
			expect(isValidTaskIdFormat('1.2.3')).toBe(true);
		});

		it('returns false for invalid IDs', () => {
			expect(isValidTaskIdFormat('')).toBe(false);
			expect(isValidTaskIdFormat('abc')).toBe(false);
			expect(isValidTaskIdFormat('1.a')).toBe(false);
			expect(isValidTaskIdFormat('HAM-123')).toBe(false);
		});
	});

	describe('taskIdSchema', () => {
		it('parses valid single IDs', () => {
			expect(taskIdSchema.parse('1')).toBe('1');
			expect(taskIdSchema.parse('15.2')).toBe('15.2');
		});

		it('throws on invalid IDs', () => {
			expect(() => taskIdSchema.parse('')).toThrow();
			expect(() => taskIdSchema.parse('abc')).toThrow();
			expect(() => taskIdSchema.parse('HAM-123')).toThrow();
		});
	});

	describe('taskIdsSchema', () => {
		it('parses single ID', () => {
			expect(taskIdsSchema.parse('1')).toBe('1');
		});

		it('parses comma-separated IDs', () => {
			expect(taskIdsSchema.parse('1,2,3')).toBe('1,2,3');
			expect(taskIdsSchema.parse('1.2, 3.4')).toBe('1.2, 3.4');
		});

		it('throws on invalid IDs', () => {
			expect(() => taskIdsSchema.parse('abc')).toThrow();
			expect(() => taskIdsSchema.parse('1,abc,3')).toThrow();
			expect(() => taskIdsSchema.parse('1,HAM-123')).toThrow();
		});
	});

	describe('parseTaskIds', () => {
		it('parses single ID', () => {
			expect(parseTaskIds('1')).toEqual(['1']);
		});

		it('parses comma-separated IDs', () => {
			expect(parseTaskIds('1, 2, 3')).toEqual(['1', '2', '3']);
			expect(parseTaskIds('1.2,3.4')).toEqual(['1.2', '3.4']);
		});

		it('trims whitespace', () => {
			expect(parseTaskIds('  1  ,  2  ')).toEqual(['1', '2']);
		});

		it('filters empty entries', () => {
			expect(parseTaskIds('1,,2')).toEqual(['1', '2']);
		});

		it('throws on invalid IDs', () => {
			expect(() => parseTaskIds('abc')).toThrow(/Invalid task ID format/);
			expect(() => parseTaskIds('HAM-123')).toThrow(/Invalid task ID format/);
		});

		it('throws on empty input', () => {
			expect(() => parseTaskIds('')).toThrow(/No valid task IDs/);
		});
	});

	describe('extractParentId', () => {
		it('extracts parent from numeric subtask ID', () => {
			expect(extractParentId('1.2')).toBe('1');
			expect(extractParentId('15.3.1')).toBe('15');
		});

		it('returns same ID for main tasks', () => {
			expect(extractParentId('1')).toBe('1');
			expect(extractParentId('15')).toBe('15');
		});
	});

	describe('isSubtaskId', () => {
		it('returns true for subtask IDs', () => {
			expect(isSubtaskId('1.2')).toBe(true);
			expect(isSubtaskId('1.2.3')).toBe(true);
		});

		it('returns false for main task IDs', () => {
			expect(isSubtaskId('1')).toBe(false);
			expect(isSubtaskId('15')).toBe(false);
		});
	});

	describe('fullSubtaskId', () => {
		it('prefixes a subtask number with its parent ID', () => {
			expect(fullSubtaskId(3, 2)).toBe('3.2');
			expect(fullSubtaskId('3', '2')).toBe('3.2');
		});

		it('keeps an ID that is already dotted', () => {
			expect(fullSubtaskId(3, '3.2')).toBe('3.2');
		});
	});
});
