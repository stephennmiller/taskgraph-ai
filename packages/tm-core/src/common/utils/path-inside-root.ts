/**
 * @fileoverview Resolve a path to the one spelling a directory walk sees.
 * rg matches globs against the path as it was typed, so a search of
 * `.docker//` slips past an exclusion glob for `.docker/config.json`. Judging
 * and passing on the resolved path keeps both on the same spelling.
 */

import fs from 'node:fs';
import path from 'node:path';

/**
 * Resolve symlinks for the longest existing prefix of an absolute path; the
 * rest, which does not exist yet, is joined on unchanged.
 * @param target - Absolute path
 * @returns The path with its existing part's symlinks followed
 */
export function realpathOfExistingPrefix(target: string): string {
	let current = target;
	const rest: string[] = [];
	for (;;) {
		try {
			return path.join(fs.realpathSync(current), ...rest.reverse());
		} catch {
			const parent = path.dirname(current);
			if (parent === current) return target;
			rest.push(path.basename(current));
			current = parent;
		}
	}
}

/**
 * Resolve a path against a root to one absolute spelling: no `//`, `./`,
 * `..` or trailing separator, and symlinks followed for the part that exists.
 * @param root - Absolute, real path of the allowed directory
 * @param candidate - Path to resolve; relative paths resolve against root
 * @returns The resolved path, or null when it leaves root, starts with `~`
 * (shell syntax that path.resolve leaves alone) or is not a string
 */
export function resolvePathInsideRoot(
	root: string,
	candidate: unknown
): string | null {
	if (typeof candidate !== 'string' || candidate.startsWith('~')) return null;
	const resolved = realpathOfExistingPrefix(path.resolve(root, candidate));
	const relative = path.relative(root, resolved);
	const leavesRoot =
		relative === '..' ||
		relative.startsWith(`..${path.sep}`) ||
		path.isAbsolute(relative);
	return leavesRoot ? null : resolved;
}
