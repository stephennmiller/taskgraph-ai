/**
 * @fileoverview What `parse-prd` says after the progress lines, e.g.
 *
 *   Saved to .taskgraph/tasks/tasks.json · 12 tasks in total · research-backed
 *   Next: taskgraph next to pick a task, or taskgraph expand --all to split them
 *
 * It replaces a boxed "Next steps" list of three commands.
 */

import { terminalWidth } from '../layout/helpers.js';
import { theme } from '../theme.js';

export interface ParsePrdSaved {
	/** Where the tasks went, relative to the current folder */
	tasksPath: string;
	/** How many tasks this run added */
	added: number;
	/** How many tasks the tag holds now */
	total: number;
	/** Whether research mode was on */
	research?: boolean;
}

/**
 * Format the lines after parse-prd saved its tasks.
 *
 * @param result - What was saved
 * @param width - Terminal width; the second command is dropped when the
 *   next-step line would not fit
 */
export function formatParsePrdSaved(
	result: ParsePrdSaved,
	width = terminalWidth()
): string {
	const facts = [`Saved to ${result.tasksPath}`];
	if (result.total > result.added) facts.push(`${result.total} tasks in total`);
	if (result.research) facts.push('research-backed');

	const short = 'Next: taskgraph next to pick a task';
	const long = `${short}, or taskgraph expand --all to split them`;
	const next =
		long.length <= width
			? theme.muted('Next: ') +
				theme.brand('taskgraph next') +
				theme.muted(' to pick a task, or ') +
				theme.brand('taskgraph expand --all') +
				theme.muted(' to split them')
			: theme.muted('Next: ') +
				theme.brand('taskgraph next') +
				theme.muted(' to pick a task');

	return [theme.muted(facts.join(' · ')), next].join('\n');
}
