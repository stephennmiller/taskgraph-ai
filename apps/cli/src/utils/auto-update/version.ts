/**
 * @fileoverview The running CLI's version
 */

import process from 'process';

/**
 * Get current version from build-time injected environment variable
 */
export function getCurrentVersion(): string {
	// Version is injected at build time via TM_PUBLIC_VERSION
	const version = process.env.TM_PUBLIC_VERSION;
	if (version && version !== 'unknown') {
		return version;
	}

	// Fallback for development or if injection failed
	console.warn('Could not read version from TM_PUBLIC_VERSION, using fallback');
	return '0.0.0';
}
