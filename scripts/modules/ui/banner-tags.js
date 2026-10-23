import { ui } from '@tm/cli';
import { shouldShowTagIndicatorForProject } from '@tm/core';
import boxen from 'boxen';
import chalk from 'chalk';
import { getTaskGraphVersion } from '../../../src/utils/getVersion.js';
import { getProjectName } from '../config-manager.js';
import { isSilentMode } from '../utils.js';
import { theme } from './theme.js';

/**
 * Display the fancy ASCII art banner for the CLI
 * Delegates to @tm/cli brand banner component
 */
export function displayAsciiBanner() {
	if (isSilentMode()) return;
	ui.displayAsciiBanner({
		version: getTaskGraphVersion(),
		projectName: getProjectName(null)
	});
}

/**
 * Display FYI notice about tagged task lists (only if migration occurred)
 * @param {Object} data - Data object that may contain _migrationHappened flag
 */
export function displayTaggedTasksFYI(data) {
	if (isSilentMode() || !data || !data._migrationHappened) return;

	console.log(
		boxen(
			chalk.bold('FYI: ') +
				theme.muted('TaskGraph now supports separate task lists per tag. ') +
				chalk.cyan(
					'Use the --tag flag to create/read/update/filter tasks by tag.'
				),
			{
				padding: { top: 0, bottom: 0, left: 2, right: 2 },
				borderColor: 'cyan',
				borderStyle: 'round',
				margin: { top: 1, bottom: 1 }
			}
		)
	);
}

/**
 * Print the muted `[tag] <name>` line above a command's output, but only when
 * it tells you something: you're on a tag other than master, or the project
 * has more than one tag. A master-only project starts with the result.
 * Note: This is an async function - callers should await it.
 * @param {string} tag - The tag the command works in
 * @param {Object} [options]
 * @param {string} [options.projectRoot] - Defaults to the project found from the working directory
 * @param {string|null} [options.tasksPath] - The tasks file the command works on (`--file`)
 */
export async function displayCurrentTagIndicator(tag, options = {}) {
	if (isSilentMode()) return;
	if (
		!shouldShowTagIndicatorForProject(
			tag || 'master',
			options.projectRoot,
			options.tasksPath
		)
	)
		return;

	console.log(ui.formatTagIndicator(tag || 'master'));
}
