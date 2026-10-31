/**
 * @fileoverview Options, result types and the output choice for `list`
 */

import type { OutputFormat, Task, TaskWithBlocks } from '@tm/core';

/**
 * Options interface for the list command
 */
export interface ListCommandOptions {
	status?: string;
	tag?: string;
	withSubtasks?: boolean;
	format?: OutputFormat;
	json?: boolean;
	compact?: boolean;
	noHeader?: boolean;
	silent?: boolean;
	project?: string;
	watch?: boolean;
	ready?: boolean;
	blocking?: boolean;
	allTags?: boolean;
	/** Only tasks assigned to the signed-in GitHub user */
	mine?: boolean;
	/**
	 * Print one plain line per task instead of the summary and table. Set
	 * when stdout isn't a terminal and no format was asked for.
	 */
	plain?: boolean;
}

/**
 * Whether `list` prints plain lines: stdout is a pipe or a file (an agent
 * or a script is reading), and nothing asked for a format or watch mode.
 * `--format text` keeps the table in a pipe.
 */
export function shouldPrintPlainList(
	options: ListCommandOptions,
	formatGiven: boolean,
	isTTY: boolean | undefined = process.stdout.isTTY
): boolean {
	return (
		!isTTY &&
		!formatGiven &&
		!options.json &&
		!options.compact &&
		!options.watch
	);
}

/**
 * Task with tag info for cross-tag listing
 */
export type TaskWithTag = TaskWithBlocks & { tagName: string };

/**
 * Result type from list command
 */
export interface ListTasksResult {
	tasks: TaskWithBlocks[] | TaskWithTag[];
	total: number;
	filtered: number;
	tag?: string;
	allTags?: boolean;
	/** ID of the task `next` would pick; only looked up for the text view */
	nextTaskId?: string | null;
	/** The task or subtask (`2.2`) `next` would pick, for the text view */
	nextTask?: Task | null;
	/**
	 * Every task in the tag with its subtasks, before filters: what the
	 * summary above the table counts. Only loaded for the text view.
	 */
	summaryTasks?: Task[];
}
