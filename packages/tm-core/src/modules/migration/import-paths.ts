/**
 * @fileoverview Path checks for importing a project folder that may come from
 * an untrusted checkout. A symlink must not let the import read files from
 * outside the folder it imports, or write outside the project.
 */

import fs from 'node:fs';
import path from 'node:path';

/** Whether `child` is `parent` or a path under it (both already resolved) */
export function isWithin(parent: string, child: string): boolean {
	const relative = path.relative(parent, child);
	return (
		relative === '' ||
		(!relative.startsWith(`..${path.sep}`) &&
			relative !== '..' &&
			!path.isAbsolute(relative))
	);
}

/**
 * Whether `file`, after following every symlink, stays under `root`. A path
 * that doesn't exist at all passes (it will be created inside `root`); a
 * dangling symlink fails, since writing to it would follow the link.
 */
export function resolvesWithin(root: string, file: string): boolean {
	if (!fs.lstatSync(file, { throwIfNoEntry: false })) return true;
	try {
		return isWithin(fs.realpathSync(root), fs.realpathSync(file));
	} catch {
		return false;
	}
}
