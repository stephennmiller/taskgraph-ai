import os from 'node:os';
import { describe, expect, it } from 'vitest';
import { readComplexityReport } from './analyze-complexity.service.js';

describe('readComplexityReport', () => {
	it('finds no report for a stored tag that is not a valid tag name, instead of throwing', () => {
		expect(readComplexityReport(os.tmpdir(), { tag: 'a/b' })).toBeNull();
	});
});
