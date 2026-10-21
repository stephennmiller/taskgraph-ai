import { describe, expect, it } from 'vitest';
import {
	MAX_SIBLING_REFERENCE,
	isSiblingReference,
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
