import { describe, expect, it } from 'vitest';
import { minimumVersion, satisfiesMinimum } from './version-range.js';

describe('minimumVersion', () => {
	it.each([
		['>=0.57.2', '0.57.2'],
		['>= 22.13.0', '22.13.0'],
		['>=v1.0.0', '1.0.0']
	])('reads %s', (range, expected) => {
		expect(minimumVersion(range)).toBe(expected);
	});

	it.each(['^1.0.0', '1.0.0', '>=1.0', '>=1.0.0 <2.0.0', ''])(
		'returns null for %j, which is not a >=x.y.z range',
		(range) => {
			expect(minimumVersion(range)).toBeNull();
		}
	);
});

describe('satisfiesMinimum', () => {
	it.each([
		['0.57.2', '>=0.57.2', true],
		['0.58.0', '>=0.57.2', true],
		['1.0.0', '>=0.57.2', true],
		['0.57.1', '>=0.57.2', false],
		['0.9.9', '>=0.10.0', false],
		['22.12.9', '>=22.13.0', false],
		['v22.13.0', '>=22.13.0', true],
		['0.58.0-beta.1', '>=0.58.0', true]
	])('%s against %s is %s', (version, range, expected) => {
		expect(satisfiesMinimum(version, range)).toBe(expected);
	});

	it('lets a version or range it cannot read through', () => {
		expect(satisfiesMinimum('unknown', '>=0.57.2')).toBe(true);
		expect(satisfiesMinimum('0.1.0', '^1.0.0')).toBe(true);
	});
});
