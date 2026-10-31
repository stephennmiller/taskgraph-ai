/**
 * @fileoverview Type definitions for the loop module
 */

import type { LoopBand, LoopEffort } from './model-bands.js';

/**
 * Available preset loop prompts
 */
export type LoopPreset =
	| 'default'
	| 'test-coverage'
	| 'linting'
	| 'duplication'
	| 'entropy'
	| 'tdd';

/**
 * Output callbacks for loop execution.
 * These allow the caller (CLI/MCP) to handle presentation while
 * the service stays focused on business logic.
 *
 * Callback modes:
 * - `onIterationStart`, `onIterationEnd`, `onError`, `onStderr`: Called in both verbose and non-verbose modes
 * - `onText`, `onToolUse`: Called only in VERBOSE mode (--verbose flag)
 * - `onOutput`: Called only in NON-VERBOSE mode (default)
 */
export interface LoopOutputCallbacks {
	/** Called at the start of each iteration (both modes) */
	onIterationStart?: (iteration: number, total: number) => void;
	/** Called when Claude outputs text (VERBOSE MODE ONLY) */
	onText?: (text: string) => void;
	/** Called when Claude invokes a tool (VERBOSE MODE ONLY) */
	onToolUse?: (toolName: string) => void;
	/** Called when an error occurs (both modes) */
	onError?: (message: string, severity?: 'warning' | 'error') => void;
	/** Called for stderr output (both modes) */
	onStderr?: (iteration: number, text: string) => void;
	/** Called when non-verbose iteration completes with output (NON-VERBOSE MODE ONLY) */
	onOutput?: (output: string) => void;
	/** Called at the end of each iteration with the result (both modes) */
	onIterationEnd?: (iteration: LoopIteration) => void;
}

/**
 * Configuration options for a loop execution
 */
export interface LoopConfig {
	/** Number of iterations to run */
	iterations: number;
	/** Preset name or custom prompt file path */
	prompt: LoopPreset | string;
	/** Path to the progress file */
	progressFile: string;
	/** Seconds to sleep between iterations */
	sleepSeconds: number;
	/** Tag context to operate on (optional) */
	tag?: string;
	/**
	 * Work on this task or subtask (`3`, `3.2`) instead of the one
	 * `taskgraph next` picks (optional). Check it first with
	 * `LoopDomain.resolveTask`.
	 */
	taskId?: string;
	/** Run Claude in Docker sandbox mode (default: false) */
	sandbox?: boolean;
	/**
	 * Skip the first-use approval for running Claude without permission prompts
	 * outside the sandbox (default: false). Meant for non-interactive runs.
	 */
	trusted?: boolean;
	/**
	 * Show Claude's work in real-time instead of just the result (default: false)
	 *
	 * When true: Output appears as Claude generates it (shows thinking, tool calls)
	 * When false: Output appears only after iteration completes
	 *
	 * Note: NOT compatible with `sandbox=true` (will return error).
	 */
	verbose?: boolean;
	/** Passed to each `claude -p` as `--max-turns` (optional) */
	maxTurns?: number;
	/**
	 * The most the whole run may spend, in US dollars (optional). Each
	 * iteration gets what's left as `--max-budget-usd`, and the run stops
	 * before an iteration once nothing is left.
	 */
	maxBudgetUsd?: number;
	/** `--model` for every iteration, in place of the band's model (optional) */
	model?: string;
	/**
	 * Complexity bands that pick each iteration's model and effort (see
	 * model-bands.ts); none means Claude Code's defaults every time
	 */
	bands?: LoopBand[];
	/**
	 * Output callbacks for presentation layer (CLI/MCP).
	 * If not provided, the service runs silently (no console output).
	 */
	callbacks?: LoopOutputCallbacks;
}

/**
 * Result of a single loop iteration
 */
export interface LoopIteration {
	/** Iteration number (1-indexed) */
	iteration: number;
	/** ID of the task worked on (if any) */
	taskId?: string;
	/** Status of this iteration */
	status: 'success' | 'blocked' | 'error' | 'complete';
	/** Optional message describing the result */
	message?: string;
	/** Duration of this iteration in milliseconds */
	duration?: number;
	/** What Claude Code reported spending, in US dollars */
	costUsd?: number;
	/** Agentic turns Claude Code took */
	turns?: number;
	/** Complexity score of the task the iteration started on, when it had one */
	complexity?: number;
	/** `--model` the iteration ran with, when one was picked */
	model?: string;
	/** `--effort` the iteration ran with, when one was picked */
	effort?: LoopEffort;
}

/**
 * Overall result of a loop execution
 */
export interface LoopResult {
	/** Array of iteration results */
	iterations: LoopIteration[];
	/** Total number of iterations executed */
	totalIterations: number;
	/** Number of tasks completed successfully */
	tasksCompleted: number;
	/** Final status of the loop */
	finalStatus:
		| 'all_complete'
		| 'max_iterations'
		| 'budget_reached'
		| 'blocked'
		| 'error';
	/** Sum of the iterations' costUsd, when any reported one */
	totalCostUsd?: number;
	/** Sum of the iterations' turns, when any reported them */
	totalTurns?: number;
	/** Error message when finalStatus is 'error' (optional) */
	errorMessage?: string;
}
