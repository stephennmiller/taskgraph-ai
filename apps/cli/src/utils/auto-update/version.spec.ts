import { describe, expect, it } from 'vitest';
import { compareVersions } from './version.js';

describe('compareVersions', () => {
	it('compares semantic versions', () => {
		expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
		expect(compareVersions('1.0.0', '1.0.1')).toBe(-1);
		expect(compareVersions('1.0.1', '1.0.0')).toBe(1);
		expect(compareVersions('1.0.0', '1.1.0')).toBe(-1);
		expect(compareVersions('1.1.0', '1.0.0')).toBe(1);
		expect(compareVersions('1.0.0', '2.0.0')).toBe(-1);
		expect(compareVersions('2.0.0', '1.0.0')).toBe(1);
		expect(compareVersions('1.0', '1.0.0')).toBe(0);
		expect(compareVersions('1.0.0.0', '1.0.0')).toBe(0);
		expect(compareVersions('1.0.0', '1.0.0.1')).toBe(-1);
	});
});
