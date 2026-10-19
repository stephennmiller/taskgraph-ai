/**
 * @fileoverview Brand-colored loading spinner
 *
 * ora only accepts named ANSI colors, so the frames are pre-painted with the
 * brand accent instead. chalk downsamples the hex to ANSI cyan on 16-color
 * terminals and drops it entirely under NO_COLOR.
 */

import chalk, { type ChalkInstance } from 'chalk';
import ora, { type Options, type Ora } from 'ora';
import { BRAND_COLORS } from './theme.js';

const DOTS = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/** ora `spinner` value: the standard dots, painted in the brand accent */
export function brandSpinner(
	paint: ChalkInstance = chalk.hex(BRAND_COLORS.accent)
): { interval: number; frames: string[] } {
	return { interval: 80, frames: DOTS.map((frame) => paint(frame)) };
}

/**
 * Create an ora spinner in the brand color. Call `.start()` to show it.
 *
 * succeed/fail/warn finish with the same ✓ ✗ ⚠ symbols the rest of the CLI
 * uses, instead of ora's heavier ✔ ✖ ⚠ from log-symbols.
 */
export function createSpinner(options: string | Options = {}): Ora {
	const base = typeof options === 'string' ? { text: options } : options;
	const spinner = ora({ ...base, spinner: brandSpinner(), color: false });
	const finish = (symbol: string) => (text?: string) =>
		spinner.stopAndPersist({ symbol, text });
	spinner.succeed = finish(chalk.green('✓'));
	spinner.fail = finish(chalk.red('✗'));
	spinner.warn = finish(chalk.yellow('⚠'));
	return spinner;
}
