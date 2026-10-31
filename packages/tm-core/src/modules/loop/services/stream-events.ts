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
	/** The session to `--resume` for the next task (#841) */
	sessionId?: string;
	/** Tokens in the context window at the last API call */
	contextTokens?: number;
}

const CAP_HIT: Record<string, string> = {
	error_max_turns: 'Claude Code reached the --max-turns limit',
	error_max_budget_usd: 'Claude Code reached the --max-budget-usd limit'
};

const finite = (value: unknown) =>
	typeof value === 'number' && Number.isFinite(value) && value >= 0
		? value
		: undefined;

/**
 * What this run spent. A resumed session's `total_cost_usd` carries on from
 * the earlier runs' total, so sum `model_usage_since_last_result` (this
 * run's calls, subagents included) when Claude Code sends it
 */
function runCost(event: Record<string, unknown>): number | undefined {
	const since = event.model_usage_since_last_result;
	if (since && typeof since === 'object') {
		const costs = Object.values(since).map((usage) =>
			finite((usage as { costUSD?: unknown } | null)?.costUSD)
		);
		if (!costs.includes(undefined)) {
			return (costs as number[]).reduce((sum, cost) => sum + cost, 0);
		}
	}
	return finite(event.total_cost_usd);
}

/** The fields loop keeps from a `result` event; fields of the wrong type are left out */
export function readResultEvent(
	event: Record<string, unknown>
): ClaudeRunResult {
	const subtype = typeof event.subtype === 'string' ? event.subtype : '';
	return {
		text: typeof event.result === 'string' ? event.result : '',
		costUsd: runCost(event),
		turns: finite(event.num_turns),
		...(Object.hasOwn(CAP_HIT, subtype) ? { capHit: CAP_HIT[subtype] } : {}),
		// A UUID; never something `claude` would read as a flag, nor the session
		// of a Claude Code that runs loop, which a cloud session's child reports
		...(typeof event.session_id === 'string' &&
		/^[A-Za-z0-9][\w-]*$/.test(event.session_id) &&
		event.session_id !== process.env.CLAUDE_CODE_SESSION_ID
			? { sessionId: event.session_id }
			: {})
	};
}

/**
 * The context an `assistant` event's API call sent: input, cache writes and
 * cache reads. Undefined for other events and for a subagent's messages.
 * (The `result` event's usage sums every turn, so it can't size the context.)
 */
export function contextTokens(
	event: Record<string, unknown>
): number | undefined {
	if (event.type !== 'assistant' || event.parent_tool_use_id) return undefined;
	const usage = (event.message as { usage?: Record<string, unknown> })?.usage;
	const input = finite(usage?.input_tokens);
	if (input === undefined) return undefined;
	return (
		input +
		(finite(usage?.cache_creation_input_tokens) ?? 0) +
		(finite(usage?.cache_read_input_tokens) ?? 0)
	);
}

/**
 * The last `result` event in stream-json output, or undefined when there is
 * none (an older Claude Code, or a process that died first)
 */
export function findResultEvent(output: string): ClaudeRunResult | undefined {
	const lines = output.split('\n');
	let run: ClaudeRunResult | undefined;
	for (let i = lines.length - 1; i >= 0; i--) {
		const event = parseEvent(lines[i]) as Record<string, unknown> | undefined;
		if (!event) continue;
		if (!run) {
			if (event.type === 'result') run = readResultEvent(event);
			continue;
		}
		// The last assistant event before the result sizes the context
		const tokens = contextTokens(event);
		if (tokens !== undefined) return { ...run, contextTokens: tokens };
	}
	return run;
}

/** Whether the output holds a stream-json event, i.e. Claude Code got going */
export const hasStreamEvent = (output: string): boolean =>
	output.split('\n').some((line) => parseEvent(line) !== undefined);

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
