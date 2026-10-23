/**
 * @fileoverview Update notification display utilities
 */

import { formatUpdateNotice } from '../../ui/formatters/update-formatters.js';

/**
 * Display upgrade notification message
 */
export function displayUpgradeNotification(
	currentVersion: string,
	latestVersion: string,
	highlights?: string[]
) {
	console.log(formatUpdateNotice(currentVersion, latestVersion, highlights));
}
