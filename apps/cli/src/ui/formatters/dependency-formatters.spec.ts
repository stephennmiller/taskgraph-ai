/**
 * Dependency formatter tests
 */

import chalk from 'chalk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { formatDependenciesWithStatus } from './dependency-formatters.js';

// Bright black (chalk.gray) is nearly invisible on Solarized Dark
const BRIGHT_BLACK = '\x1b[90m';

describe('formatDependenciesWithStatus', () => {
	let originalLevel: typeof chalk.level;

	beforeAll(() => {
		// Vitest runs without a TTY, so force color output to inspect escape codes
		originalLevel = chalk.level;
		chalk.level = 3;
	});

	afterAll(() => {
		chalk.level = originalLevel;
	});

	it('should show "none" when there are no dependencies', () => {
		expect(formatDependenciesWithStatus([], [])).toContain('none');
	});

	it('should not render the empty state in bright black', () => {
		expect(formatDependenciesWithStatus([], [])).not.toContain(BRIGHT_BLACK);
	});
});
