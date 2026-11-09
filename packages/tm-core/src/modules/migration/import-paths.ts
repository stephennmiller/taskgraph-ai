/**
 * @fileoverview Path checks for importing a project folder that may come from
 * an untrusted checkout. A symlink must not let the import read files from
 * outside the folder it imports, or write outside the project.
 */

import fs from 'node:fs';
import path from 'node:path';
import { isWithin } from '../../common/utils/project-root-finder.js';

/**
 * Whether `file`, after following every symlink, stays under `root`. A path
 * that doesn't exist at all passes (it will be created inside `root`); a
 * dangling symlink fails, since writing to it would follow the link. So does
 * a link into `root`'s .git: a write there could plant a hook.
 */
export function resolvesWithin(root: string, file: string): boolean {
	if (!fs.lstatSync(file, { throwIfNoEntry: false })) return true;
	try {
		const realRoot = fs.realpathSync(root);
		const real = fs.realpathSync(file);
		const top = path.relative(realRoot, real).split(path.sep)[0];
		// Lowercased: .GIT is .git on a case-insensitive disk
		return isWithin(realRoot, real) && top.toLowerCase() !== '.git';
	} catch {
		return false;
	}
}
