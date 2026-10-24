/**
 * @fileoverview What `remove-task` removed, e.g.
 *
 *   ✓ Removed task 2
 *   ✓ Removed 3 tasks: 2, 5.1, 7
 *   2 tasks depend on missing tasks. Run: taskgraph fix-dependencies
 *
 * It replaces a green box reading "Successfully removed 1 task(s)/subtask(s)."
 * over a "Details:" list that said the same again.
 */

import { TAG_NAME_PATTERN } from '@tm/core';
import chalk from 'chalk';
import { theme } from '../theme.js';
import { terminalSafe } from './markdown-formatters.js';

/**
 * @param ids - The task and subtask IDs removed, as typed (`2`, `5.1`)
 * @param danglingDependents - Tasks and subtasks left that still depend on
 *   a missing task, from `removeTask`
 * @param tag - The tag given with `--tag`, named in the fix command
 */
export function formatTasksRemoved(
	ids: string[],
	danglingDependents = 0,
	tag?: string
): string {
	const safe = ids.map(terminalSafe);
	const removed =
		safe.length === 1
			? `${chalk.green('✓')} Removed ${safe[0].includes('.') ? 'subtask' : 'task'} ${safe[0]}`
			: `${chalk.green('✓')} Removed ${safe.length} tasks: ${safe.join(', ')}`;
	if (danglingDependents === 0) return removed;
	const tagFlag =
		tag === undefined
			? ''
			: ` --tag ${TAG_NAME_PATTERN.test(tag) ? tag : '<tag>'}`;
	const count =
		danglingDependents === 1
			? '1 task depends'
			: `${danglingDependents} tasks depend`;
	return `${removed}\n${theme.muted(`${count} on missing tasks. Run: `)}${theme.brand(`taskgraph fix-dependencies${tagFlag}`)}`;
}
