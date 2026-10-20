import { ui } from '@tm/cli';
import { isSilentMode } from '../utils.js';

/**
 * Start a loading indicator with an animated spinner
 * @param {string} message - Message to display next to the spinner
 * @returns {Object} Spinner object
 */
export function startLoadingIndicator(message) {
	if (isSilentMode()) return null;

	const spinner = ui.createSpinner(message).start();

	return spinner;
}

/**
 * Live progress for parse-prd: prints each task as the model finishes it.
 * Returns null in silent mode.
 * @param {Object} options - See ParsePrdProgressOptions in @tm/cli
 */
export function startParsePrdProgress(options) {
	if (isSilentMode()) return null;
	return new ui.ParsePrdProgress(options).start();
}

/**
 * Stop a loading indicator (basic stop, no success/fail indicator)
 * @param {Object} spinner - Spinner object to stop
 */
export function stopLoadingIndicator(spinner) {
	if (spinner && typeof spinner.stop === 'function') {
		spinner.stop();
	}
}

/**
 * Complete a loading indicator with success (shows checkmark)
 * @param {Object} spinner - Spinner object to complete
 * @param {string} message - Optional success message (defaults to current text)
 */
export function succeedLoadingIndicator(spinner, message = null) {
	if (spinner && typeof spinner.succeed === 'function') {
		if (message) {
			spinner.succeed(message);
		} else {
			spinner.succeed();
		}
	}
}

/**
 * Complete a loading indicator with failure (shows X)
 * @param {Object} spinner - Spinner object to fail
 * @param {string} message - Optional failure message (defaults to current text)
 */
export function failLoadingIndicator(spinner, message = null) {
	if (spinner && typeof spinner.fail === 'function') {
		if (message) {
			spinner.fail(message);
		} else {
			spinner.fail();
		}
	}
}

/**
 * Complete a loading indicator with warning (shows warning symbol)
 * @param {Object} spinner - Spinner object to warn
 * @param {string} message - Optional warning message (defaults to current text)
 */
export function warnLoadingIndicator(spinner, message = null) {
	if (spinner && typeof spinner.warn === 'function') {
		if (message) {
			spinner.warn(message);
		} else {
			spinner.warn();
		}
	}
}

/**
 * Complete a loading indicator with info (shows info symbol)
 * @param {Object} spinner - Spinner object to complete with info
 * @param {string} message - Optional info message (defaults to current text)
 */
export function infoLoadingIndicator(spinner, message = null) {
	if (spinner && typeof spinner.info === 'function') {
		if (message) {
			spinner.info(message);
		} else {
			spinner.info();
		}
	}
}
