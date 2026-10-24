/**
 * @fileoverview The top-level help screen, printed before the rest of the CLI
 * loads (#248). It imports only what the screen draws, so `taskgraph --help`
 * starts as fast as `--version`.
 */

import {
	displayAsciiBanner,
	isTopLevelHelpRequest,
	shouldShowAsciiBanner
} from './ui/components/brand-banner.component.js';
import { formatHelp } from './ui/formatters/help-formatters.js';

export { isTopLevelHelpRequest };

/**
 * Print `taskgraph --help`: the banner in a terminal, then the commands.
 *
 * @param args - The arguments after the script path (`process.argv.slice(2)`)
 * @param version - Shown in the banner
 */
export function printTopLevelHelp(args: string[], version: string): void {
	if (shouldShowAsciiBanner(args, Boolean(process.stdout.isTTY))) {
		displayAsciiBanner({ version });
	}
	console.log(formatHelp());
}
