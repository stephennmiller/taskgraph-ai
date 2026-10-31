/**
 * @fileoverview Reading Claude's `--output-format stream-json` output in a
 * `loop --verbose` iteration
 */

import type { LoopOutputCallbacks } from '../types.js';

/**
 * Validate that a parsed JSON object has the expected stream event structure.
 */
export function isValidStreamEvent(event: unknown): event is {
	type: string;
	message?: {
		content?: Array<{ type: string; text?: string; name?: string }>;
	};
	result?: string;
} {
	if (!event || typeof event !== 'object') {
		return false;
	}

	const e = event as Record<string, unknown>;
	if (!('type' in e) || typeof e.type !== 'string') {
		return false;
	}

	// Validate message structure if present
	if ('message' in e && e.message !== undefined) {
		if (typeof e.message !== 'object' || e.message === null) {
			return false;
		}
		const msg = e.message as Record<string, unknown>;
		if ('content' in msg && !Array.isArray(msg.content)) {
			return false;
		}
	}

	return true;
}

export function handleStreamEvent(
	event: {
		type: string;
		message?: {
			content?: Array<{ type: string; text?: string; name?: string }>;
		};
	},
	callbacks?: LoopOutputCallbacks
): void {
	if (event.type !== 'assistant' || !event.message?.content) return;

	for (const block of event.message.content) {
		if (block.type === 'text' && block.text) {
			callbacks?.onText?.(block.text);
		} else if (block.type === 'tool_use' && block.name) {
			callbacks?.onToolUse?.(block.name);
		}
	}
}

export function processBufferedLines(
	buffer: string,
	newData: string
): { complete: string[]; remaining: string } {
	const combined = buffer + newData;
	const lines = combined.split('\n');
	return {
		complete: lines.slice(0, -1),
		remaining: lines[lines.length - 1]
	};
}

/**
 * Claude Code arguments for structured output: one JSON event per line, the
 * last a `result` event with the run's cost and turn count
 */
export const STREAM_JSON_ARGS = ['--output-format', 'stream-json', '--verbose'];

/** What one Claude Code run cost, read from its final `result` event */
export interface ClaudeRunResult {
	/** The reply's text, checked for completion markers */
	text: string;
	costUsd?: number;
	turns?: number;
	/** Why Claude Code stopped early, when a --max-turns or --max-budget-usd cap ended it */
	capHit?: string;
}

const CAP_HIT: Record<string, string> = {
	error_max_turns: 'Claude Code reached the --max-turns limit',
	error_max_budget_usd: 'Claude Code reached the --max-budget-usd limit'
};

const finite = (value: unknown) =>
	typeof value === 'number' && Number.isFinite(value) && value >= 0
		? value
		: undefined;

/** The fields loop keeps from a `result` event; fields of the wrong type are left out */
export function readResultEvent(
	event: Record<string, unknown>
): ClaudeRunResult {
	const subtype = typeof event.subtype === 'string' ? event.subtype : '';
	return {
		text: typeof event.result === 'string' ? event.result : '',
		costUsd: finite(event.total_cost_usd),
		turns: finite(event.num_turns),
		...(Object.hasOwn(CAP_HIT, subtype) ? { capHit: CAP_HIT[subtype] } : {})
	};
}

/**
 * The last `result` event in stream-json output, or undefined when there is
 * none (an older Claude Code, or a process that died first)
 */
export function findResultEvent(output: string): ClaudeRunResult | undefined {
	const lines = output.split('\n');
	for (let i = lines.length - 1; i >= 0; i--) {
		const event = parseEvent(lines[i]);
		if (event?.type === 'result') {
			return readResultEvent(event as Record<string, unknown>);
		}
	}
	return undefined;
}

/** The output with its stream-json events taken out, for a run with no result event */
export function withoutEvents(output: string): string {
	return output
		.split('\n')
		.filter((line) => !parseEvent(line))
		.join('\n');
}

function parseEvent(line: string) {
	const text = line.trim();
	if (!text.startsWith('{')) return undefined;
	try {
		const event: unknown = JSON.parse(text);
		return isValidStreamEvent(event) ? event : undefined;
	} catch {
		// Not an event: stderr text in a log, or a cut-off line
		return undefined;
	}
}
