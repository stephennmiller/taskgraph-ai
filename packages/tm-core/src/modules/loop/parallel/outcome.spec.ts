import { describe, expect, it } from 'vitest';
import { KEPT_OUTCOMES, settledOutcome } from './outcome.js';

describe('settledOutcome', () => {
	it('names what became of each settled task', () => {
		expect(settledOutcome('done', true, true, false)).toBe('kept');
		expect(settledOutcome('done', false, false, false)).toBe('no-changes');
		expect(settledOutcome('stopped', true, false, false)).toBe('stopped');
		expect(settledOutcome('stopped', false, false, false)).toBe('no-changes');
		expect(settledOutcome('failed', false, false, false)).toBe('failed');
		expect(settledOutcome('failed', true, false, false)).toBe('released');
		expect(settledOutcome('failed', true, true, false)).toBe('failed-kept');
		expect(settledOutcome('failed', true, true, true)).toBe(
			'container-running'
		);
	});

	it('counts only outcomes that leave a branch as kept for review', () => {
		expect(KEPT_OUTCOMES.has('kept')).toBe(true);
		expect(KEPT_OUTCOMES.has('released')).toBe(true);
		expect(KEPT_OUTCOMES.has('merged')).toBe(false);
		expect(KEPT_OUTCOMES.has('set-aside')).toBe(false);
		expect(KEPT_OUTCOMES.has('no-changes')).toBe(false);
		expect(KEPT_OUTCOMES.has('failed')).toBe(false);
	});
});
