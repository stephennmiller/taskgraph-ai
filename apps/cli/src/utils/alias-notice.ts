/**
 * @fileoverview One dim line when an old command name is used, so a script
 * learns the new name before the old one goes away (#930):
 *
 *   (add-dependency is now taskgraph depend)
 *
 * It goes to stderr, so the command's own stdout stays unchanged.
 */

import type { Command } from 'commander';
import { theme } from '../ui/theme.js';

/**
 * Print the notice on stderr before the command runs.
 * @param command - The old command
 * @param replacement - What to type instead, after `taskgraph`
 */
export function noticeOldAlias(command: Command, replacement: string): void {
	const name = command.name();
	command.hook('preAction', () => {
		console.error(theme.muted(`(${name} is now taskgraph ${replacement})`));
	});
}
