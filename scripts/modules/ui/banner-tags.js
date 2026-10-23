import { ui } from '@tm/cli';
import { shouldShowTagIndicatorForProject } from '@tm/core';
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
		theme.muted(
			'TaskGraph now keeps a separate task list per tag; use --tag to work in one'
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
