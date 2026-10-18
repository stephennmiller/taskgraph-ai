import chalk from 'chalk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { theme } from './theme.js';

describe('theme', () => {
	let originalLevel: typeof chalk.level;

	beforeAll(() => {
		// Vitest runs without a TTY, so force color output to compare escape codes
		originalLevel = chalk.level;
		chalk.level = 3;
	});

	afterAll(() => {
		chalk.level = originalLevel;
	});

	describe('roles', () => {
		it('renders brand, accent and active text differently', () => {
			const rendered = [theme.brand, theme.accent, theme.active].map((style) =>
				style('x')
			);

			expect(new Set(rendered).size).toBe(rendered.length);
		});
	});

	describe('text', () => {
		it('does not reset enclosing styles when nested inside bold text', () => {
			const output = theme.text.bold(`Title ${theme.text.italic('emph')} here`);

			// A reset (\x1b[0m) inside bold text would turn bold off for " here"
			expect(output).not.toContain('\x1b[0m');
		});
	});
});
