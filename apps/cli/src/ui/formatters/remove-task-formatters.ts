/**
 * @fileoverview What `remove-task` removed, e.g.
 *
 *   ✓ Removed task 2
 *   ✓ Removed 3 tasks: 2, 5.1, 7
 *
 * It replaces a green box reading "Successfully removed 1 task(s)/subtask(s)."
 * over a "Details:" list that said the same again.
 */

import chalk from 'chalk';

/** @param ids - The task and subtask IDs removed, as typed (`2`, `5.1`) */
export function formatTasksRemoved(ids: string[]): string {
	if (ids.length === 1) {
		const kind = ids[0].includes('.') ? 'subtask' : 'task';
		return `${chalk.green('✓')} Removed ${kind} ${ids[0]}`;
	}
	return `${chalk.green('✓')} Removed ${ids.length} tasks: ${ids.join(', ')}`;
}
