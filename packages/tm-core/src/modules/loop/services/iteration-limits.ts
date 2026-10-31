/**
 * @fileoverview What ends a loop iteration or the run when Claude Code
 * hangs or keeps failing (#659)
 */

import {
	formatTimeout,
	timeoutFromEnv
} from '../../../common/utils/timeout-from-env.js';
import { LoopError } from '../loop-task.js';

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

/** Caps on each `claude -p` loop starts (#837) */
export interface ClaudeCaps {
	maxTurns?: number;
	maxBudgetUsd?: number;
}

/**
 * Check `--max-turns` and `--max-budget-usd` before anything runs
 * @throws LoopError (with a hint) for a value that isn't a positive number
 */
export function parseLoopCaps(flags: {
	maxTurns?: string;
	maxBudgetUsd?: string;
}): ClaudeCaps {
	const caps: ClaudeCaps = {};
	if (flags.maxTurns !== undefined) {
		const text = flags.maxTurns.trim();
		const n = /^\d+$/.test(text) ? Number(text) : 0;
		if (!Number.isSafeInteger(n) || n < 1) {
			throw new LoopError(
				`"${text}" isn't a turn count for --max-turns`,
				'Pass a whole number of 1 or more, e.g. `taskgraph loop --max-turns 50`'
			);
		}
		caps.maxTurns = n;
	}
	if (flags.maxBudgetUsd !== undefined) {
		const text = flags.maxBudgetUsd.trim().replace(/^\$/, '');
		const n = /^\d*\.?\d+$/.test(text) ? Number(text) : 0;
		if (!(n >= 0.01) || !Number.isFinite(n)) {
			throw new LoopError(
				`"${flags.maxBudgetUsd.trim()}" isn't a dollar amount for --max-budget-usd`,
				'Pass an amount of at least 0.01, e.g. `taskgraph loop --max-budget-usd 5`'
			);
		}
		caps.maxBudgetUsd = n;
	}
	return caps;
}

/** `claude -p` arguments for the caps; a budget is cut down to a hundredth of a cent so it never rounds up */
export function capArgs({ maxTurns, maxBudgetUsd }: ClaudeCaps): string[] {
	return [
		...(maxTurns ? ['--max-turns', String(maxTurns)] : []),
		...(maxBudgetUsd !== undefined
			? ['--max-budget-usd', String(Math.floor(maxBudgetUsd * 10_000) / 10_000)]
			: [])
	];
}
