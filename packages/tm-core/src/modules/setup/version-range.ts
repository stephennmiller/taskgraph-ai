/**
 * @fileoverview The one kind of version range TaskGraph's setup checks use:
 * a minimum, written `>=1.2.3`. Node's `engines` field and the plugin's
 * `metadata.taskgraphCli` both take this form, so a semver dependency isn't
 * worth its install size.
 */

const VERSION_RE = /^v?(\d+)\.(\d+)\.(\d+)/;
const MINIMUM_RE = /^\s*>=\s*(v?\d+\.\d+\.\d+)\s*$/;

/** [major, minor, patch] of `1.2.3`, `v1.2.3` or `1.2.3-beta.1`, or null */
function parts(version: string): [number, number, number] | null {
	const match = VERSION_RE.exec(version.trim());
	return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

/** The version a `>=1.2.3` range starts at, or null for any other range */
export function minimumVersion(range: string): string | null {
	return MINIMUM_RE.exec(range)?.[1].replace(/^v/, '') ?? null;
}

/**
 * Whether `version` meets the `>=x.y.z` range. A version or range that
 * can't be read counts as meeting it: a setup check should never stop
 * someone over a version string it doesn't understand.
 */
export function satisfiesMinimum(version: string, range: string): boolean {
	const have = parts(version);
	const min = minimumVersion(range);
	const need = min ? parts(min) : null;
	if (!have || !need) return true;
	for (let i = 0; i < 3; i++) {
		if (have[i] !== need[i]) return have[i] > need[i];
	}
	return true;
}
