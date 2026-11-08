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
	if (!have || !min) return true;
	// A prerelease of the minimum meets it
	return compareVersions(have.join('.'), min) >= 0;
}

/**
 * Compare semantic versions with proper pre-release handling
 * @param v1 - First version
 * @param v2 - Second version
 * @returns -1 if v1 < v2, 0 if v1 = v2, 1 if v1 > v2
 */
export function compareVersions(v1: string, v2: string): number {
	const toParts = (v: string) => {
		const [core, pre = ''] = v.split('-', 2);
		const nums = core.split('.').map((n) => Number.parseInt(n, 10) || 0);
		return { nums, pre };
	};

	const a = toParts(v1);
	const b = toParts(v2);
	const len = Math.max(a.nums.length, b.nums.length);

	// Compare numeric parts
	for (let i = 0; i < len; i++) {
		const d = (a.nums[i] || 0) - (b.nums[i] || 0);
		if (d !== 0) return d < 0 ? -1 : 1;
	}

	// Handle pre-release comparison
	if (a.pre && !b.pre) return -1; // prerelease < release
	if (!a.pre && b.pre) return 1; // release > prerelease
	if (a.pre === b.pre) return 0; // same or both empty
	return a.pre < b.pre ? -1 : 1; // basic prerelease tie-break
}
