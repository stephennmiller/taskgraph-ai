/**
 * @fileoverview CLI wording for the git checks behind `--from-branch`
 */

import { ERROR_CODES } from '@tm/core';

const NAME_INSTEAD = 'Name the tag instead: `taskgraph tags add <name>`';

const MESSAGES: Record<string, string> = {
	[ERROR_CODES.NOT_GIT_REPO]:
		"--from-branch needs a git repository, and this isn't one",
	[ERROR_CODES.NO_CURRENT_BRANCH]:
		"Couldn't tell which git branch is checked out"
};

/**
 * The error to show for a failed `--from-branch`: a missing repository or
 * branch becomes the CLI's message with a hint to name the tag instead; any
 * other error is returned as it is.
 */
export function fromBranchError(error: unknown): unknown {
	const code = (error as { code?: unknown } | null)?.code;
	const message = typeof code === 'string' ? MESSAGES[code] : undefined;
	if (!message) return error;
	return Object.assign(new Error(message), {
		hint: NAME_INSTEAD,
		cause: error
	});
}
