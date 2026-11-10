/**
 * @fileoverview Update notification display utilities
 */

import { formatUpdateNotice } from '../../ui/formatters/update-formatters.js';

/**
 * Display upgrade notification message.
 * `hint` adds the line that tells the user to run `taskgraph upgrade`,
 * for a notify-only run that is not about to install.
 */
export function displayUpgradeNotification(
	currentVersion: string,
	latestVersion: string,
	highlights?: string[],
	options?: { hint?: boolean }
) {
	// stderr: stdout may be redirected or piped while stdin is a terminal (#1106)
	console.error(
		formatUpdateNotice(
			currentVersion,
			latestVersion,
			highlights,
			undefined,
			options?.hint ?? false
		)
	);
}
