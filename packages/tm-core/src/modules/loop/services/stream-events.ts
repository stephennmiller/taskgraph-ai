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
