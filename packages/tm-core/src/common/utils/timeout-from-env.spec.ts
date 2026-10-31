import { describe, expect, it } from 'vitest';
import { formatTimeout } from './timeout-from-env.js';

describe('formatTimeout', () => {
	it.each([
		[60_000, '1 minute'],
		[600_000, '10 minutes'],
		[1_000, '1 second'],
		[30_000, '30 seconds']
	])('%i ms reads as %s', (ms, text) => {
		expect(formatTimeout(ms)).toBe(text);
	});
});
