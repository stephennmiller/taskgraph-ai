/**
 * Honors the NO_COLOR convention (https://no-color.org): when NO_COLOR is set
 * to a non-empty value, color output is turned off. An explicit FORCE_COLOR
 * from the user still wins.
 *
 * Sets FORCE_COLOR=0 for modules that load later and also switches off the
 * shared chalk instance directly, because the bundler may load chalk before
 * this code runs. gradient-string and ora share that instance.
 */
import chalk from 'chalk';

/**
 * @param {NodeJS.ProcessEnv} env - Environment to read and update
 * @param {{ level: number }} colorInstance - chalk instance to switch off
 */
export function applyNoColor(env, colorInstance = chalk) {
	if (env.NO_COLOR && env.FORCE_COLOR === undefined) {
		env.FORCE_COLOR = '0';
		colorInstance.level = 0;
	}
}

applyNoColor(process.env);
