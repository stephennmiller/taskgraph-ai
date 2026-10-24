/**
 * git-utils.js
 * Git helpers for init
 */

import { execSync } from 'child_process';

/**
 * Check if the current working directory is inside a Git work-tree.
 * Uses `git rev-parse --is-inside-work-tree` which is more specific than --git-dir
 * for detecting work-trees (excludes bare repos and .git directories).
 * This is ideal for preventing accidental git init in existing work-trees.
 * @returns {boolean} True if inside a Git work-tree, false otherwise.
 */
function insideGitWorkTree() {
	try {
		execSync('git rev-parse --is-inside-work-tree', {
			stdio: 'ignore',
			cwd: process.cwd()
		});
		return true;
	} catch {
		return false;
	}
}

export { insideGitWorkTree };
