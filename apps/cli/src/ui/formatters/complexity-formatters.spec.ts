/**
 * Complexity formatter tests
 */

import chalk from 'chalk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	getComplexityWithColor,
	getComplexityWithScore
} from './complexity-formatters.js';

// Bright black (chalk.gray) is nearly invisible on Solarized Dark
const BRIGHT_BLACK = '\x1b[90m';

describe('complexity formatters', () => {
	let originalLevel: typeof chalk.level;

	beforeAll(() => {
		// Vitest runs without a TTY, so force color output to inspect escape codes
		originalLevel = chalk.level;
		chalk.level = 3;
	});

	afterAll(() => {
		chalk.level = originalLevel;
	});

	describe('getComplexityWithColor', () => {
		it('should show N/A for a non-numeric score', () => {
			expect(getComplexityWithColor('abc')).toContain('N/A');
		});

		it('should not render N/A in bright black', () => {
			expect(getComplexityWithColor('abc')).not.toContain(BRIGHT_BLACK);
		});
	});

	describe('getComplexityWithScore', () => {
		it('should show N/A when the score is missing', () => {
			expect(getComplexityWithScore(undefined)).toContain('N/A');
		});

		it('should not render N/A in bright black', () => {
			expect(getComplexityWithScore(undefined)).not.toContain(BRIGHT_BLACK);
		});
	});
});
