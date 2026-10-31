/**
 * @fileoverview What one loop iteration came to: Claude's completion marker,
 * its exit code, and the cost and turns it reported
 */

import type { LoopIteration } from '../types.js';
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

/** The iteration's result from the reply, the exit code and the cost Claude Code reported */
export function completeIteration(
	iterationNum: number,
	startTime: number,
	reply: string,
	exitCode: number,
	run: ClaudeRunResult | undefined
): LoopIteration {
	const { status, message } = parseCompletion(reply, exitCode);
	return {
		iteration: iterationNum,
		status,
		duration: Date.now() - startTime,
		// A cap that stopped Claude says more than its exit code
		message: (status === 'error' && run?.capHit) || message,
		...(run?.costUsd !== undefined ? { costUsd: run.costUsd } : {}),
		...(run?.turns !== undefined ? { turns: run.turns } : {})
	};
}
