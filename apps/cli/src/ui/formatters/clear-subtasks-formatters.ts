/**
 * @fileoverview What `clear-subtasks` removed, e.g.
 *
 *   ✓ Cleared 4 subtasks from 2 tasks
 *     1  3 subtasks  Set up the database schema
 *     2  1 subtask   Build the login API
 *   Task 3 had no subtasks
 *   Run taskgraph expand --id=<id> to add new ones
 *
 * It replaces a boxed heading, a table wider than 80 columns, a boxed
 * success message and a boxed "Next Steps" list.
 */

import { sanitizeForTerminal } from '@tm/core';
import chalk from 'chalk';
import { terminalWidth } from '../layout/helpers.js';
import { theme } from '../theme.js';

export interface ClearedTask {
	id: number | string;
	title: string;
	/** How many subtasks were removed */
	count: number;
}

export interface ClearSubtasksResult {
	/** Tasks whose subtasks were removed, in order */
	cleared: ClearedTask[];
	/** Tasks that had no subtasks to remove */
	empty: Array<{ id: number | string; title: string }>;
}

const plural = (count: number, noun: string) =>
	`${count} ${count === 1 ? noun : `${noun}s`}`;

const fit = (text: string, width: number) =>
	text.length > width ? `${text.slice(0, Math.max(1, width - 1))}…` : text;

/** `Task 3 had no subtasks`, `Tasks 3 and 5 …`, or `7 tasks …` for many */
function describeEmpty(ids: Array<number | string>): string {
	if (ids.length === 1) return `Task ${ids[0]} had no subtasks`;
	if (ids.length <= 3) {
		const list = `${ids.slice(0, -1).join(', ')} and ${ids.at(-1)}`;
		return `Tasks ${list} had no subtasks`;
	}
	return `${ids.length} tasks had no subtasks`;
}

/**
 * Format the result of clearing subtasks.
 *
 * @param result - What clearSubtasks returned
 * @param width - Terminal width; titles are cut to fit on one line
 */
export function formatClearedSubtasks(
	result: ClearSubtasksResult,
	width = terminalWidth()
): string {
	result = sanitizeForTerminal(result);
	const { cleared, empty } = result;

	if (cleared.length === 0) {
		if (empty.length === 1) return `Task ${empty[0].id} has no subtasks`;
		return 'No subtasks to clear';
	}

	const total = cleared.reduce((sum, task) => sum + task.count, 0);
	const from =
		cleared.length === 1
			? `task ${cleared[0].id}`
			: plural(cleared.length, 'task');
	const lines = [
		`${chalk.green('✓')} Cleared ${plural(total, 'subtask')} from ${from}`
	];

	const ids = cleared.map((task) => String(task.id));
	const idWidth = Math.max(...ids.map((id) => id.length));
	const counts =
		cleared.length > 1
			? cleared.map((task) => plural(task.count, 'subtask'))
			: [];
	const countWidth = Math.max(0, ...counts.map((count) => count.length));
	// 2-space indent, the ID, 2 spaces, then the count column and 2 more
	const titleWidth = Math.max(
		10,
		width - 4 - idWidth - (countWidth ? countWidth + 2 : 0)
	);

	cleared.forEach((task, index) => {
		const count = counts.length
			? `${theme.muted(counts[index].padEnd(countWidth))}  `
			: '';
		lines.push(
			`  ${theme.brand(ids[index].padEnd(idWidth))}  ${count}${fit(task.title, titleWidth)}`
		);
	});

	if (empty.length > 0) {
		lines.push(theme.muted(describeEmpty(empty.map((task) => task.id))));
	}

	const expandId = cleared.length === 1 ? String(cleared[0].id) : '<id>';
	lines.push(
		theme.muted('Run ') +
			theme.brand(`taskgraph expand --id=${expandId}`) +
			theme.muted(' to add new ones')
	);

	return lines.join('\n');
}
