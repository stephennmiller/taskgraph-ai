/**
 * @fileoverview What `parse-prd` says after the progress lines, e.g.
 *
 *   Saved to .taskgraph/tasks/tasks.json · 12 tasks in total · research-backed
 *   Next: taskgraph loop to build them, or taskgraph next to pick one
 *
 * It replaces a boxed "Next steps" list of three commands. As a step of `go`
 * the next-step line is left out: `go` starts loop itself.
 */

import { sanitizeForTerminal } from '@tm/core';
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
	/** false leaves the `Next:` line out (default true) */
	nextStep?: boolean;
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
	result = sanitizeForTerminal(result);
	const facts = [`Saved to ${result.tasksPath}`];
	if (result.total > result.added) facts.push(`${result.total} tasks in total`);
	if (result.research) facts.push('research-backed');

	const saved = theme.muted(facts.join(' · '));
	if (result.nextStep === false) return saved;

	const short = 'Next: taskgraph loop to build them';
	const long = `${short}, or taskgraph next to pick one`;
	const next =
		theme.muted('Next: ') +
		theme.brand('taskgraph loop') +
		theme.muted(' to build them') +
		(long.length <= width
			? theme.muted(', or ') +
				theme.brand('taskgraph next') +
				theme.muted(' to pick one')
			: '');

	return [saved, next].join('\n');
}
