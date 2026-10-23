/**
 * @fileoverview The notice printed before TaskGraph updates itself, e.g.
 *
 *   TaskGraph 1.1.0 is out (you have 1.0.0)
 *     • Add Codex CLI provider with OAuth authentication
 *     • Move to AI SDK v5
 *
 * The install spinner prints on the next line, so this doesn't also say
 * "Auto-updating…". It replaces a yellow box headed "Update Available!".
 */

import chalk from 'chalk';
import { terminalWidth, wrapLine } from '../layout/helpers.js';
import { theme } from '../theme.js';

/**
 * Format the update notice.
 *
 * @param highlights - Changelog lines for the new version; long ones wrap
 *   under their text
 * @param width - Terminal width
 */
export function formatUpdateNotice(
	currentVersion: string,
	latestVersion: string,
	highlights: string[] = [],
	width = terminalWidth()
): string {
	const lines = [
		`${theme.brand('TaskGraph')} ${chalk.green(latestVersion)} is out ${theme.muted(`(you have ${currentVersion})`)}`
	];
	for (const highlight of highlights) {
		lines.push(...wrapLine(`  • ${highlight}`, width, '    '));
	}
	return lines.join('\n');
}
