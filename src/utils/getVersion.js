import packageJson from '../../package.json' with { type: 'json' };

/**
 * Reads the version from the nearest package.json relative to this file.
 * Returns 'unknown' if not found or on error.
 * @returns {string} The version string or 'unknown'.
 */
export function getTaskGraphVersion() {
	return packageJson.version || 'unknown';
}
