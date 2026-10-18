/**
 * Status formatter tests
 * Tests for apps/cli/src/utils/formatters/status-formatters.ts
 */

import chalk from 'chalk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getPriorityWithColor } from './priority-formatters.js';
import * as statusFormatters from './status-formatters.js';
import { getStatusWithColor } from './status-formatters.js';

// Bright black (chalk.gray) is nearly invisible on Solarized Dark
const BRIGHT_BLACK = '\x1b[90m';

describe('Status Formatters', () => {
	let originalLevel: typeof chalk.level;

	beforeAll(() => {
		// Vitest runs without a TTY, so force color output to inspect escape codes
		originalLevel = chalk.level;
		chalk.level = 3;
	});

	afterAll(() => {
		chalk.level = originalLevel;
	});

	describe('getStatusWithColor', () => {
		it('should use different icons for deferred and cancelled', () => {
			const deferred = getStatusWithColor('deferred');
			const cancelled = getStatusWithColor('cancelled');

			expect(deferred.replace('deferred', '')).not.toBe(
				cancelled.replace('cancelled', '')
			);
		});

		it('should not render muted statuses in bright black', () => {
			expect(getStatusWithColor('deferred')).not.toContain(BRIGHT_BLACK);
			expect(getStatusWithColor('cancelled')).not.toContain(BRIGHT_BLACK);
		});
	});

	describe('getPriorityWithColor', () => {
		it('should not render low priority in bright black', () => {
			expect(getPriorityWithColor('low')).not.toContain(BRIGHT_BLACK);
		});
	});

	it('does not export the brief status helpers', () => {
		expect('getBriefStatusWithColor' in statusFormatters).toBe(false);
		expect('getBriefStatusIcon' in statusFormatters).toBe(false);
		expect('getBriefStatusColor' in statusFormatters).toBe(false);
		expect('capitalizeStatus' in statusFormatters).toBe(false);
	});
});
