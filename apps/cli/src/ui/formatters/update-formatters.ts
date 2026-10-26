/**
 * @fileoverview The notice printed before TaskGraph updates itself, e.g.
 *
 *   TaskGraph 1.1.0 is out (you have 1.0.0)
 *     • Add Codex CLI provider with OAuth authentication
 *     • Move to AI SDK v5
 *
 * By default the CLI only notifies. Pass `hint` to add the line that says
 * how to install (`taskgraph upgrade`). An opted-in install leaves the hint
 * off: the install spinner prints on the next line.
 */

import { stripTerminalControls } from '@tm/core';
import chalk from 'chalk';
import { terminalWidth, wrapLine } from '../layout/helpers.js';
import { theme } from '../theme.js';

/**
 * Format the update notice.
 *
 * @param highlights - Changelog lines for the new version; long ones wrap
 *   under their text. They come from the remote changelog (or the update
 *   cache), so escape sequences and line breaks are stripped
 * @param width - Terminal width
 */
export function formatUpdateNotice(
	currentVersion: string,
	latestVersion: string,
	highlights: string[] = [],
	width = terminalWidth(),
	hint = false
): string {
	const lines = [
		`${theme.brand('TaskGraph')} ${chalk.green(stripTerminalControls(latestVersion, { singleLine: true }))} is out ${theme.muted(`(you have ${currentVersion})`)}`
	];
	for (const highlight of highlights) {
		lines.push(
			...wrapLine(
				`  • ${stripTerminalControls(highlight, { singleLine: true })}`,
				width,
				'    '
			)
		);
	}
	if (hint) {
		lines.push(theme.muted('Run `taskgraph upgrade` to install it'));
	}
	return lines.join('\n');
}
