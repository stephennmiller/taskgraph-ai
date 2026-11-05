/**
 * @fileoverview Unit tests for the `list` option checks
 */

import { describe, expect, it, vi } from 'vitest';
import { validateListOptions } from './list.validate.js';

describe('format validation', () => {
	it('should accept valid formats', () => {
		expect(validateListOptions({ format: 'text' })).toBe(true);
		expect(validateListOptions({ format: 'json' })).toBe(true);
		expect(validateListOptions({ format: 'compact' })).toBe(true);
	});

	it('should reject invalid formats', () => {
		const consoleErrorSpy = vi
			.spyOn(console, 'error')
			.mockImplementation(() => {});

		expect(validateListOptions({ format: 'invalid' as never })).toBe(false);
		expect(consoleErrorSpy).toHaveBeenCalledWith(
			expect.stringContaining('Invalid format: invalid')
		);

		consoleErrorSpy.mockRestore();
	});

	it('rejects an unknown status on two lines, with no leading blank', () => {
		const consoleErrorSpy = vi
			.spyOn(console, 'error')
			.mockImplementation(() => {});
		const plain = (text: string) => text.replace(/\u001b\[[0-9;]*m/g, '');

		expect(validateListOptions({ status: 'pending' })).toBe(true);
		expect(validateListOptions({ status: 'bogus' })).toBe(false);
		expect(validateListOptions({ status: 'pending,all' })).toBe(false);
		const printed = consoleErrorSpy.mock.calls.map((call) =>
			plain(String(call[0]))
		);
		expect(printed[0]).toMatch(
			/^✗ "bogus" isn't a status\n {2}Use one of: pending,/
		);
		expect(printed[0].startsWith('\n')).toBe(false);
		expect(printed[1]).toMatch(/^✗ "all" isn't a status\n {2}Use one of: /);

		consoleErrorSpy.mockRestore();
	});
});
