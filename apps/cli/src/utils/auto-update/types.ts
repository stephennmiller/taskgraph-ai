/**
 * @fileoverview Type definitions for auto-update functionality
 */

export interface UpdateInfo {
	currentVersion: string;
	latestVersion: string;
	needsUpdate: boolean;
	highlights?: string[];
	/** The registry couldn't be reached, so latestVersion is only the running version */
	failed?: boolean;
}
