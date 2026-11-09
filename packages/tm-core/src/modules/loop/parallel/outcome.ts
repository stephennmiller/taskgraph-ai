/**
 * @fileoverview How each task of a `loop --parallel` run ended (#1033)
 */

import fs from 'node:fs';
import type { ParallelTaskState } from './types.js';

/** How a task's run ended, decided in core once it settled */
export type ParallelTaskOutcome =
	/** --merge: its branch was merged into the current branch, and the worktree removed */
	| 'merged'
	/** Nothing to keep: the worktree was removed */
	| 'no-changes'
	/** The worktree and branch were kept for review */
	| 'kept'
	/** Stopped by an abort: the worktree with its work kept, the claim released */
	| 'stopped'
	/** Failed: the worktree kept, the claim released so a later run retries it there */
	| 'released'
	/** Failed: its clone kept and the task still claimed, as its branch couldn't come back */
	| 'failed-kept'
	/** Failed: its container may still be running, so the clone and claim are left */
	| 'container-running'
	/** Failed, and its empty worktree removed */
	| 'failed'
	/** --merge: its branch conflicted, so its work was kept under `setAsideAs` and the task redone */
	| 'set-aside'
	/** --merge: its branch conflicted and couldn't be set aside, which ends the run */
	| 'conflict'
	/** --merge: not merged, as its worktree has uncommitted work */
	| 'unmerged';

/** Outcomes that leave a worktree or branch for someone to review */
export const KEPT_OUTCOMES: ReadonlySet<ParallelTaskOutcome> = new Set([
	'kept',
	'stopped',
	'released',
	'failed-kept',
	'container-running',
	'conflict',
	'unmerged'
]);

/** The outcome settle gives a task once its process is gone and its worktree kept or removed */
export function settledOutcome(
	state: ParallelTaskState,
	kept: boolean,
	claimed: boolean,
	stuck: boolean
): ParallelTaskOutcome {
	if (stuck) return 'container-running';
	if (state === 'failed') {
		if (!kept) return 'failed';
		return claimed ? 'failed-kept' : 'released';
	}
	if (!kept) return 'no-changes';
	return state === 'stopped' ? 'stopped' : 'kept';
}

/**
 * Why a task's process didn't start, in plain words. spawn reports a
 * missing working folder as ENOENT too (#1104)
 */
export const describeSpawnError = (
	error: NodeJS.ErrnoException,
	command: string,
	cwd: string
) =>
	error.code !== 'ENOENT'
		? `Couldn't start ${command}: ${error.message}`
		: fs.existsSync(cwd)
			? `${command} isn't installed or isn't on PATH`
			: `The working folder ${cwd} is missing`;
