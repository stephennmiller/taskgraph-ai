/**
 * @fileoverview Watch mode footer component for real-time task updates
 */

import chalk from 'chalk';
import { formatTime } from '@tm/core';
import { theme } from '../theme.js';

/** Display label for the watched task file */
const SOURCE_LABEL = 'tasks.json';

/**
 * Display watch status footer
 */
export function displayWatchFooter(lastSync: Date): void {
	const syncTime = formatTime(lastSync);

	console.log(chalk.dim(`\nWatching ${SOURCE_LABEL} for changes...`));
	console.log(theme.muted(`Last synced: ${syncTime}`));
	console.log(chalk.dim('Press Ctrl+C to exit'));
}

/**
 * Display sync notification message
 */
export function displaySyncMessage(syncTime: Date): void {
	const formattedTime = formatTime(syncTime);

	console.log(theme.brand(`\nℹ ${SOURCE_LABEL} updated at ${formattedTime}`));
}
