/**
 * @fileoverview When a loop iteration resumes the previous iteration's
 * Claude Code session instead of starting cold (#841). A cold start re-reads
 * CLAUDE.md and re-explores the repo; a resumed one already has them. Set the
 * context size past which loop starts fresh under `loop.resumeMaxContextTokens`
 * in .taskgraph/config.json (0 turns resuming off).
 */

import { LoopError } from './loop-task.js';
import type { ModelChoice } from './model-bands.js';
import type { LoopIteration } from './types.js';

/** Half of a 200k context window: a long session gets a fresh one before Claude Code compacts it */
export const DEFAULT_RESUME_MAX_CONTEXT_TOKENS = 100_000;

/**
 * `loop.resumeMaxContextTokens` from the project config, or the default
 * @throws LoopError (with a hint) for a value that isn't a whole number of 0 or more
 */
export function resolveResumeLimit(loop: unknown): number {
	const value =
		loop && typeof loop === 'object'
			? (loop as { resumeMaxContextTokens?: unknown }).resumeMaxContextTokens
			: undefined;
	if (value === undefined) return DEFAULT_RESUME_MAX_CONTEXT_TOKENS;
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
		throw new LoopError(
			`loop.resumeMaxContextTokens in .taskgraph/config.json is ${JSON.stringify(value)}; use a whole number of tokens`,
			`Set it to a number such as ${DEFAULT_RESUME_MAX_CONTEXT_TOKENS}, 0 to start every task fresh, or remove it`
		);
	}
	return value;
}

/**
 * The session the next iteration resumes: the previous iteration's, when it
 * succeeded, its context is below the limit, and the next one runs at the
 * same model and effort (a different model reads the history cold anyway).
 * Undefined means start fresh.
 */
export function resumableSession(
	previous: LoopIteration | undefined,
	next: ModelChoice,
	maxContextTokens: number
): string | undefined {
	if (
		!previous?.sessionId ||
		previous.status !== 'success' ||
		previous.contextTokens === undefined ||
		previous.contextTokens >= maxContextTokens ||
		previous.model !== next.model ||
		previous.effort !== next.effort
	) {
		return undefined;
	}
	return previous.sessionId;
}
