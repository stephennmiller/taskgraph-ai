import { describe, expect, it } from 'vitest';
import { TASK_STATUSES, statusesWhere } from './index.js';

// Pins what each status meant before the table (#1032); a change here is a behavior change
describe('TASK_STATUS_MEANINGS', () => {
	it('lists every status in the order help and errors print them', () => {
		expect(TASK_STATUSES).toEqual([
			'pending',
			'in-progress',
			'done',
			'deferred',
			'cancelled',
			'blocked',
			'review'
		]);
	});

	it.each([
		['complete', ['done', 'cancelled']],
		['pickable', ['pending', 'in-progress']],
		['actionable', ['pending', 'in-progress', 'review']],
		['finished', ['done', 'review']],
		['active', ['pending', 'in-progress', 'blocked']],
		['open', ['pending', 'in-progress', 'deferred', 'blocked', 'review']],
		['importable', ['blocked', 'review']]
	] as const)('%s is %j', (meaning, statuses) => {
		expect(statusesWhere(meaning)).toEqual(statuses);
	});
});
