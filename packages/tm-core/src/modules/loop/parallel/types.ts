/**
 * @fileoverview Types for `loop --parallel`
 */

import type { ChildProcess, SpawnOptions } from 'node:child_process';
import type { ModelChoice } from '../model-bands.js';

/** Starts one Claude Code process; `child_process.spawn` by default */
type AgentSpawner = (
	command: string,
	args: string[],
	options: SpawnOptions
) => ChildProcess;

/** Where a task's run stands */
export type ParallelTaskState =
	/** Claude Code is working on it */
	| 'running'
	/** Claude Code exited 0 */
	| 'done'
	/** Couldn't start, or Claude Code exited non-zero */
	| 'failed'
	/** Stopped by an abort before Claude Code finished */
	| 'stopped';

/** One task in a parallel run; model and effort are what its complexity picked */
export interface ParallelTask extends ModelChoice {
	id: string;
	title: string;
	/** `taskgraph/task-<id>` */
	branch: string;
	/** Absolute path of the task's worktree */
	worktree: string;
	/** Absolute path of the file holding Claude Code's output */
	logFile: string;
	state: ParallelTaskState;
	/** When Claude Code started (ms since epoch) */
	startedAt: number;
	/** How long it ran, once it stopped */
	durationMs?: number;
	exitCode?: number | null;
	/** Why it failed, in plain words */
	error?: string;
	/** What Claude Code reported spending, in US dollars (set when it exits) */
	costUsd?: number;
	/** Claude Code started but reported no cost: killed, timed out or crashed (set when it exits) */
	costUnknown?: boolean;
	/** Agentic turns Claude Code took (set when it exits) */
	turns?: number;
	/** Commits on the branch past the starting commit (set at the end) */
	commits?: number;
	/** Uncommitted changes left in the worktree (set at the end) */
	uncommitted?: boolean;
	/** The worktree and branch were kept for review (set at the end) */
	kept?: boolean;
	/** The task is still claimed (in-progress) after the run (set at the end) */
	claimed?: boolean;
	/**
	 * Claude Code exited 0 and the task is in review or done: what the
	 * summary counts as done, like the sequential loop (set at the end)
	 */
	finished?: boolean;
}

/** Progress callbacks for the presentation layer */
export interface ParallelLoopCallbacks {
	/** A task was claimed, its worktree made and Claude Code started */
	onTaskStart?: (task: ParallelTask) => void;
	/** Claude Code exited, failed to start, or was stopped */
	onTaskEnd?: (task: ParallelTask) => void;
}

export interface ParallelLoopOptions {
	/** How many tasks to run at once (1 to MAX_PARALLEL) */
	parallel: number;
	/** Tag to take tasks from; the active tag when omitted */
	tag?: string;
	/** Run without asking for the permission-prompt approval (see loop --trust) */
	trusted?: boolean;
	/** Recorded as the claim owner; the session ID or user name by default */
	claimant?: string;
	/** Passed to each task's `claude -p` as `--max-turns` */
	maxTurns?: number;
	/**
	 * The most the whole run may spend, in US dollars: each task's
	 * `claude -p` gets an equal share as `--max-budget-usd`
	 */
	maxBudgetUsd?: number;
	/** `--model` for every task, in place of the band's model */
	model?: string;
	/** Stops the run: children are killed, claims released */
	signal?: AbortSignal;
	callbacks?: ParallelLoopCallbacks;
	/**
	 * Run each task's Claude Code in its own container (`--container`), from
	 * this image or DEFAULT_CONTAINER_IMAGE, with this runtime (`docker` by
	 * default; tests pass a stand-in)
	 */
	container?: { image?: string; runtime?: string };
	/** The Claude Code executable; `claude` by default */
	command?: string;
	/** Starts the processes; `child_process.spawn` by default */
	spawner?: AgentSpawner;
	/** How long a stopped process gets to exit before SIGKILL (default 5000) */
	killGraceMs?: number;
}

export interface ParallelLoopResult {
	/** Tasks that ran, in the order they started */
	tasks: ParallelTask[];
	/** Tasks in the ready wave (wave 1) when the run started */
	readyCount: number;
	/** Ready tasks left out because their ID can't be a branch name */
	skippedIds: string[];
	/** The run was aborted */
	aborted: boolean;
	/** Sum of the tasks' costUsd, when any reported one */
	totalCostUsd?: number;
	/** A task's cost is unknown and not in totalCostUsd, so the run spent at least that */
	costPartial?: boolean;
}
