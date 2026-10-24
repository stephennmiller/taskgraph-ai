import { describe, expect, it } from 'vitest';
import {
	buildFixtureTasks,
	median
} from '../../../.github/scripts/check-startup-time.mjs';

describe('check-startup-time', () => {
	it('takes the middle sample, so one slow run cannot fail the check', () => {
		expect(median([120, 2000, 110])).toBe(120);
		expect(median([100, 300, 200, 4000])).toBe(250);
	});

	it('refuses to take the median of no samples', () => {
		expect(() => median([])).toThrow('median of no values');
	});

	it('builds a tagged tasks.json with the requested number of tasks', () => {
		const { master } = buildFixtureTasks(40);

		expect(master.tasks).toHaveLength(40);
		expect(master.tasks[0].dependencies).toEqual([]);
		expect(master.tasks[39]).toMatchObject({ id: 40, dependencies: [39] });
	});
});
