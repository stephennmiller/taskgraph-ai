import { describe, expect, it } from 'vitest';
import { promotedSubtaskDescription } from './promoted-subtask.js';

describe('promotedSubtaskDescription', () => {
	it('keeps a description the subtask has', () => {
		expect(
			promotedSubtaskDescription({ title: 'Child', description: 'Do it' })
		).toBe('Do it');
	});

	it.each([
		['missing', undefined],
		['null', null],
		['empty', ''],
		['blank', '  ']
	])('uses the title when the description is %s', (_, description) => {
		expect(promotedSubtaskDescription({ title: 'Child', description })).toBe(
			'Child'
		);
	});
});
