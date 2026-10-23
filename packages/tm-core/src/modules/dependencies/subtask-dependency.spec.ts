import { describe, expect, it } from 'vitest';
import {
	MAX_SIBLING_REFERENCE,
	cleanGeneratedSubtaskDependencies,
	isSiblingReference,
	parseSubtaskDependencyInput,
	resolveSubtaskDependency
} from './subtask-dependency.js';

describe('resolveSubtaskDependency', () => {
	it('reads a bare number as a sibling subtask', () => {
		expect(resolveSubtaskDependency('5', 3)).toBe('5.3');
	});

	it('reads a string without a dot as a task', () => {
		expect(resolveSubtaskDependency('5', '3')).toBe('3');
	});

	it('keeps a dotted ID as the subtask it names', () => {
		expect(resolveSubtaskDependency('5', '2.1')).toBe('2.1');
	});

	it('accepts a numeric parent ID', () => {
		expect(resolveSubtaskDependency(5, 3)).toBe('5.3');
	});

	it('reads a bare number above the cutoff as a task', () => {
		expect(resolveSubtaskDependency('5', MAX_SIBLING_REFERENCE)).toBe('5.99');
		expect(resolveSubtaskDependency('5', MAX_SIBLING_REFERENCE + 1)).toBe(
			'100'
		);
		expect(resolveSubtaskDependency('5', 150)).toBe('150');
	});
});

describe('isSiblingReference', () => {
	it('is true only for numbers up to the cutoff', () => {
		expect(isSiblingReference(1)).toBe(true);
		expect(isSiblingReference(MAX_SIBLING_REFERENCE)).toBe(true);
		expect(isSiblingReference(MAX_SIBLING_REFERENCE + 1)).toBe(false);
		expect(isSiblingReference('1')).toBe(false);
		expect(isSiblingReference('1.2')).toBe(false);
	});
});

describe('parseSubtaskDependencyInput', () => {
	it('reads a bare ID as a task, as add-dependency does', () => {
		const ids = parseSubtaskDependencyInput('3');

		expect(ids).toEqual(['3']);
		expect(resolveSubtaskDependency('5', ids[0])).toBe('3');
	});

	it('keeps dotted subtask IDs and trims, skips empty entries and repeats', () => {
		expect(parseSubtaskDependencyInput(' 3, 5.2,,3 ')).toEqual(['3', '5.2']);
	});

	it('rejects an entry that is not a task or subtask ID', () => {
		expect(() => parseSubtaskDependencyInput('3,abc')).toThrow(
			'"abc" is not a task or subtask ID. Use IDs like 3 or 5.2'
		);
		expect(() => parseSubtaskDependencyInput('0')).toThrow();
		expect(() => parseSubtaskDependencyInput('1.2.3')).toThrow();
	});
});

describe('cleanGeneratedSubtaskDependencies', () => {
	it('keeps a string task ID below 100 as a task, not a sibling', () => {
		const deps = cleanGeneratedSubtaskDependencies(['3'], 5, 2);

		expect(deps).toEqual(['3']);
		expect(resolveSubtaskDependency(5, deps[0])).toBe('3');
	});

	it('keeps siblings, dotted subtasks and numeric task IDs of 100 or more', () => {
		expect(
			cleanGeneratedSubtaskDependencies([1, '2.1', 150, ' 4 '], 5, 3)
		).toEqual([1, '2.1', 150, '4']);
	});

	it('drops siblings that are not earlier than the subtask', () => {
		expect(cleanGeneratedSubtaskDependencies([1, 2, 3], 5, 2)).toEqual([1]);
	});

	it('keeps any sibling when no subtask ID is given', () => {
		expect(cleanGeneratedSubtaskDependencies([4], 5)).toEqual([4]);
	});

	it('drops malformed entries, the parent itself and repeats of one item', () => {
		expect(
			cleanGeneratedSubtaskDependencies(
				['task 3', '', 0, -1, 1.5, null, '5', 5.0, 1, '5.1', '3', 3],
				5,
				4
			)
		).toEqual([1, '3', 3]);
	});

	it('returns an empty list for a missing list', () => {
		expect(cleanGeneratedSubtaskDependencies(undefined, 5)).toEqual([]);
	});
});
