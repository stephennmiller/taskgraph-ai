/**
 * Points git at the hooks in .githooks. Runs from the "prepare" script.
 * Never fails an install: outside a git checkout, or when another hooks path
 * is already configured, it does nothing.
 */
import { execFileSync } from 'node:child_process';

const git = (...args) =>
	execFileSync('git', args, { stdio: ['ignore', 'pipe', 'ignore'] })
		.toString()
		.trim();

try {
	git('rev-parse', '--git-dir');

	let current = '';
	try {
		current = git('config', '--get', 'core.hooksPath');
	} catch {
		// not set
	}

	if (current && current !== '.githooks') {
		console.log(
			`Leaving core.hooksPath as "${current}"; the pre-push format check is not installed.`
		);
	} else if (!current) {
		git('config', 'core.hooksPath', '.githooks');
	}
} catch {
	// not a git checkout, or git is unavailable
}
