/**
 * @fileoverview Brand-colored loading spinner
 *
 * ora only accepts named ANSI colors, so the frames are pre-painted with the
 * brand accent instead. chalk downsamples the hex to ANSI cyan on 16-color
 * terminals and drops it entirely under NO_COLOR.
 */

import { createRequire } from 'node:module';
import chalk, { type ChalkInstance } from 'chalk';
import type { Options, Ora } from 'ora';
import { BRAND_COLORS, theme } from './theme.js';

// ora loads with the first spinner, not at startup (#248). require() keeps
// createSpinner synchronous.
const require = createRequire(import.meta.url);

const DOTS = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/** ora `spinner` value: the standard dots, painted in the brand accent */
export function brandSpinner(
	paint: ChalkInstance = chalk.hex(BRAND_COLORS.accent)
): { interval: number; frames: string[] } {
	return { interval: 80, frames: DOTS.map((frame) => paint(frame)) };
}

/** Waits shorter than this show no clock */
const ELAPSED_AFTER_SECONDS = 3;

/**
 * Create an ora spinner in the brand color. Call `.start()` to show it.
 *
 * succeed/fail/warn finish with the same ✓ ✗ ⚠ symbols the rest of the CLI
 * uses, instead of ora's heavier ✔ ✖ ⚠ from log-symbols.
 *
 * Once a wait passes a few seconds the spinner adds the elapsed time
 * (`Writing the new task… 12s`). Pass `elapsed: false` when the text already
 * carries its own clock.
 */
export function createSpinner(
	options: string | (Options & { elapsed?: boolean }) = {}
): Ora {
	const { elapsed = true, ...base } =
		typeof options === 'string' ? { text: options } : options;
	const { default: ora } = require('ora') as typeof import('ora');
	const spinner = ora({ ...base, spinner: brandSpinner(), color: false });
	const finish = (symbol: string) => (text?: string) =>
		spinner.stopAndPersist({ symbol, text, suffixText: '' });
	spinner.succeed = finish(chalk.green('✓'));
	spinner.fail = finish(chalk.red('✗'));
	spinner.warn = finish(chalk.yellow('⚠'));
	if (!elapsed) return spinner;

	let ticker: NodeJS.Timeout | undefined;
	const start = spinner.start.bind(spinner);
	const stop = spinner.stop.bind(spinner);
	spinner.start = (text) => {
		start(text);
		// Not spinning when the output isn't a terminal: print nothing extra
		if (spinner.isSpinning && !ticker) {
			const started = Date.now();
			ticker = setInterval(() => {
				const seconds = Math.floor((Date.now() - started) / 1000);
				if (seconds >= ELAPSED_AFTER_SECONDS) {
					spinner.suffixText = theme.muted(`${seconds}s`);
				}
			}, 1000);
			// The clock alone never keeps the process alive
			ticker.unref();
		}
		return spinner;
	};
	// stopAndPersist (succeed/fail/warn) calls stop too
	spinner.stop = () => {
		clearInterval(ticker);
		ticker = undefined;
		spinner.suffixText = '';
		return stop();
	};
	return spinner;
}
