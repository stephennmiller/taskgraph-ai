/**
 * IDE marker definitions for auto-detection.
 * Maps profile names to their filesystem markers.
 */

/**
 * Represents an IDE marker configuration
 */
export interface IDEMarker {
	/** Profile name matching RULE_PROFILES */
	profileName: string;
	/** Markers to check (first match wins) */
	markers: Array<{ path: string; type: 'directory' | 'file' }>;
	/** Human-readable display name */
	displayName: string;
}

/**
 * IDE marker definitions - directory or file-based detection.
 */
export const IDE_MARKERS: IDEMarker[] = [
	{
		profileName: 'claude',
		markers: [{ path: '.claude', type: 'directory' }],
		displayName: 'Claude Code'
	}
];

/**
 * Get IDE marker config for a specific profile
 */
export function getIDEMarker(profileName: string): IDEMarker | undefined {
	return IDE_MARKERS.find((m) => m.profileName === profileName);
}

/**
 * Check if a profile has detectable markers
 */
export function isDetectableProfile(profileName: string): boolean {
	return IDE_MARKERS.some((m) => m.profileName === profileName);
}
