/**
 * @fileoverview One dim line when an old command name is used, so a script
 * learns the new name before the old one goes away (#930):
 *
 *   (add-dependency is now taskgraph depend)
 *
 * It goes to stderr, so a `--json` payload on stdout stays the payload alone.
 * `--json` and `--silent` are for scripts, which already know the command
 * they called, so the line is skipped there.
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
	command.hook('preAction', (thisCommand) => {
		if (aliasNoticeSuppressed(thisCommand)) return;
		console.error(theme.muted(`(${name} is now taskgraph ${replacement})`));
	});
}

/** A script run (`--json`, `--format json`, `--silent`) gets no notice */
function aliasNoticeSuppressed(command: Command): boolean {
	const opts = command.optsWithGlobals();
	return opts.json === true || opts.silent === true || opts.format === 'json';
}
