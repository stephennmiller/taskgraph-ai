/**
 * @fileoverview What `sync-readme` prints when it has written README.md, e.g.
 *
 *   ✓ Synced tasks to README.md · with subtasks · status: pending
 *
 * It replaces four emoji lines (syncing, success, export details, location).
 */

import chalk from 'chalk';
import { theme } from '../theme.js';
import { terminalSafe } from './markdown-formatters.js';

/** The one line `sync-readme` prints when it succeeds */
export function formatReadmeSync(options: {
	withSubtasks?: boolean;
	status?: string;
}): string {
	const details = [
		options.withSubtasks ? 'with subtasks' : '',
		options.status ? `status: ${terminalSafe(options.status)}` : ''
	].filter(Boolean);
	const suffix = details.map((detail) => ` · ${detail}`).join('');
	return `${chalk.green('✓')} Synced tasks to README.md${theme.muted(suffix)}`;
}
