/**
 * Error hints must only point at things that exist: the auth and brief
 * commands were removed with the Hamster integration (issue #16).
 */
import { formatError } from '../../../scripts/modules/error-formatter.js';

describe('formatError hints', () => {
	test.each([
		['an expired token', 'Your token has expired'],
		['an unauthorized response', 'Request was unauthorized'],
		['a rejected API key', 'The API key was rejected']
	])('does not send %s to a removed auth command', (_label, message) => {
		const { hints } = formatError(new Error(message));

		expect(hints.length).toBeGreaterThan(0);
		for (const hint of hints) {
			expect(hint).not.toMatch(/tm auth/i);
		}
	});

	test('treats a brief ID error like any other validation error', () => {
		const { type, hints } = formatError(new Error('Invalid brief ID: ham32'));

		expect(type).toBe('validation');
		for (const hint of hints) {
			expect(hint).not.toMatch(/brief/i);
		}
	});
});
