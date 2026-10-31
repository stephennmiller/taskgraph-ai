/**
 * @fileoverview What one loop iteration came to: Claude's completion marker,
 * its exit code, and the cost and turns it reported
 */

import type { LoopIteration } from '../types.js';
import { CLAUDE_MISSING, DOCKER_MISSING } from './iteration-limits.js';
import type { ClaudeRunResult } from './stream-events.js';

/** A marker counts only alone on the last non-empty line, so quoting it in a sentence doesn't stop the loop */
const SIGNAL_LINE = /^<loop-(complete|blocked)>([^<]*)<\/loop-\1>$/i;

/** `complete` or `blocked` from a marker alone on the reply's last line, else success or an exit-code error */
export function parseCompletion(
	output: string,
	exitCode: number
): { status: LoopIteration['status']; message?: string } {
	const lastLine = output.trimEnd().split('\n').pop()?.trim() ?? '';
	const signal = lastLine.match(SIGNAL_LINE);
	if (signal) {
		const status =
			signal[1].toLowerCase() === 'complete' ? 'complete' : 'blocked';
		return { status, message: signal[2].trim() };
	}

	if (exitCode !== 0)
		return { status: 'error', message: `Exit code ${exitCode}` };
	return { status: 'success' };
}

/**
 * The iteration's result from the reply, the exit code and the cost Claude
 * Code reported. `started`: Claude Code printed a stream-json event.
 */
export function completeIteration(
	iterationNum: number,
	startTime: number,
	reply: string,
	exitCode: number,
	run: ClaudeRunResult | undefined,
	started = false
): LoopIteration {
	const { status, message } = parseCompletion(reply, exitCode);
	return {
		iteration: iterationNum,
		status,
		duration: Date.now() - startTime,
		// A cap that stopped Claude says more than its exit code
		message: (status === 'error' && run?.capHit) || message,
		...(run?.costUsd !== undefined ? { costUsd: run.costUsd } : {}),
		...(run?.turns !== undefined ? { turns: run.turns } : {}),
		...(run?.sessionId ? { sessionId: run.sessionId } : {}),
		...(run?.contextTokens !== undefined
			? { contextTokens: run.contextTokens }
			: {}),
		// Died mid-run (a crash, or docker's 137 for a killed container) (#855)
		...(!run && exitCode !== 0 && started ? { costUnknown: true } : {})
	};
}

export type RunSpend = Pick<LoopIteration, 'costUsd' | 'turns' | 'costUnknown'>;

/** For a run loop stopped or that died: the cost and turns Claude Code reported, or `costUnknown` (#855) */
export function runSpend(run: ClaudeRunResult | undefined): RunSpend {
	return {
		...(run?.costUsd !== undefined
			? { costUsd: run.costUsd }
			: { costUnknown: true }),
		...(run?.turns !== undefined ? { turns: run.turns } : {})
	};
}

/** What went wrong starting `claude` or `docker`, in plain words */
export function formatCommandError(
	error: NodeJS.ErrnoException,
	command: string,
	sandbox: boolean
): string {
	if (error.code === 'ENOENT') {
		return sandbox ? DOCKER_MISSING : CLAUDE_MISSING;
	}

	if (error.code === 'EACCES') {
		return `Permission denied executing '${command}'`;
	}

	return `Failed to execute '${command}': ${error.message}`;
}

/** `spent` once Claude ran: what it reported, or that it reported no cost */
export function createErrorIteration(
	iterationNum: number,
	startTime: number,
	message: string,
	spent?: RunSpend
): LoopIteration {
	return {
		iteration: iterationNum,
		status: 'error',
		duration: Date.now() - startTime,
		message,
		...spent
	};
}
