import { ui } from '@tm/cli';
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
 * Display a small, non-intrusive indicator showing the current tag context
 * Note: This is an async function - callers should await it.
 * @param {string} tag - The tag name to display
 * @param {Object} options - Display options
 * @param {boolean} [options.skipIfMaster=false] - Don't show indicator if tag is 'master'
 * @param {boolean} [options.dim=false] - Use dimmed styling
 */
export async function displayCurrentTagIndicator(tag, options = {}) {
	if (isSilentMode()) return;

	const { skipIfMaster = false, dim = false } = options;

	// Skip display for master tag only if explicitly requested
	if (skipIfMaster && tag === 'master') return;

	// Using ASCII characters for consistent cross-platform display
	const displayText = dim
		? theme.muted(`[tag] ${tag}`)
		: chalk.dim('[tag] ') + chalk.cyan(tag);

	console.log(displayText);
}
