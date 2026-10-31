/**
 * @fileoverview What ends a loop iteration or the run when Claude Code
 * hangs or keeps failing (#659)
 */

import {
	formatTimeout,
	timeoutFromEnv
} from '../../../common/utils/timeout-from-env.js';

/** Errors in a row that end the run, so a broken setup doesn't burn every iteration */
export const MAX_CONSECUTIVE_ERRORS = 3;

/** Iterations in a row that change no task status before the run stops as stuck (#812) */
export const MAX_STALLED_ITERATIONS = 2;

const DEFAULT_ITERATION_TIMEOUT_MS = 60 * 60 * 1000;

/** One iteration's limit: TASKGRAPH_LOOP_TIMEOUT_MS, else an hour */
export const loopIterationTimeoutMs = () =>
	timeoutFromEnv('TASKGRAPH_LOOP_TIMEOUT_MS', DEFAULT_ITERATION_TIMEOUT_MS);

export const CLAUDE_MISSING =
	'Claude CLI is not installed. Install with: npm install -g @anthropic-ai/claude-code';
export const DOCKER_MISSING =
	'Docker is not installed. Install Docker Desktop to use --sandbox mode.';

export function timeoutMessage(ms: number): string {
	return `Claude didn't finish within ${formatTimeout(ms)} and was stopped. Set TASKGRAPH_LOOP_TIMEOUT_MS (milliseconds) to allow longer.`;
}
