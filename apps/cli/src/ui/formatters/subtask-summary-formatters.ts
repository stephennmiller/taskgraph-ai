/**
 * @fileoverview What `expand` just created, e.g.
 *
 *   ✓ Added 3 subtasks to task 3
 *     3.1  Implement fetchTitle helper
 *     3.2  Wire the add command to storage
 *     3.3  Test duplicate URLs
 *
 * Without it the command ended on the usage line and the only sign of the
 * new subtasks was a debug log.
 */

import { sanitizeForTerminal } from '@tm/core';
import chalk from 'chalk';
import { terminalWidth } from '../layout/helpers.js';
import { theme } from '../theme.js';

/** The subtask fields the summary shows */
export interface SubtaskSummaryItem {
	id: number | string;
	title: string;
}

/**
 * Format the confirmation for subtasks just added to a task.
 *
 * @param parentId - The task the subtasks belong to
 * @param subtasks - The new subtasks only, in order
 * @param width - Terminal width; titles are cut to fit on one line
 */
export function formatAddedSubtasks(
	parentId: number | string,
	subtasks: SubtaskSummaryItem[],
	width = terminalWidth()
): string {
	subtasks = sanitizeForTerminal(subtasks);
	const count = subtasks.length;
	const noun = count === 1 ? 'subtask' : 'subtasks';
	const lines = [
		`${chalk.green('✓')} Added ${count} ${noun} to task ${parentId}`
	];

	const ids = subtasks.map((subtask) => `${parentId}.${subtask.id}`);
	const idWidth = Math.max(0, ...ids.map((id) => id.length));
	// 2-space indent + ID column + 2-space gap
	const titleWidth = Math.max(10, width - idWidth - 4);

	subtasks.forEach((subtask, index) => {
		const title =
			subtask.title.length > titleWidth
				? `${subtask.title.slice(0, titleWidth - 1)}…`
				: subtask.title;
		lines.push(`  ${theme.brand(ids[index].padEnd(idWidth))}  ${title}`);
	});

	return lines.join('\n');
}
