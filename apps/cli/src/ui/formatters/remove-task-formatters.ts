/**
 * @fileoverview What `remove-task` asks before it removes, e.g.
 *
 *   3    Add a rate limiter to the login endpoint so brute force attempts…
 *   5.2  Write the migration
 *   Tasks 4, 6 depend on them and lose that dependency
 *   ? Delete task 3 and 3 subtasks? This can't be undone. (y/N)
 *
 * and what it removed, e.g.
 *
 *   ✓ Removed task 2
 *   ✓ Removed 3 tasks: 2, 5.1, 7
 *   2 tasks depend on missing tasks. Run: taskgraph fix-dependencies
 *
 * It replaces a green box reading "Successfully removed 1 task(s)/subtask(s)."
 * over a "Details:" list that said the same again.
 */

import { TAG_NAME_PATTERN, type TaskRemovalPreview } from '@tm/core';
import chalk from 'chalk';
import { terminalWidth } from '../layout/helpers.js';
import { theme } from '../theme.js';
import { terminalSafe } from './markdown-formatters.js';
import { fit, plural } from './parallel-loop-formatters.js';

/** The rows above remove-task's question: each item's title, cut to `width`, then who depends on them */
export function formatRemovalPlan(
	{ found, dependents }: TaskRemovalPreview,
	width = terminalWidth()
): string {
	const ids = found.map(({ id }) => terminalSafe(id));
	const idWidth = Math.max(...ids.map((id) => id.length));
	const rows = found.map(({ title }, i) => {
		const head = `  ${ids[i].padEnd(idWidth)}  `;
		return theme.text(head + fit(title || '(no title)', width - head.length));
	});
	// Not the ones that go too
	const dependentIds = [
		...new Set(dependents.flatMap((d) => d.dependentIds.map(terminalSafe)))
	].filter((id) => !ids.includes(id));
	if (dependentIds.length > 0) {
		const one = dependentIds.length === 1;
		rows.push(
			theme.muted(
				fit(
					`${one ? 'Task' : 'Tasks'} ${dependentIds.join(', ')} ${one ? 'depends' : 'depend'} on ${found.length === 1 ? 'it' : 'them'} and ${one ? 'loses' : 'lose'} that dependency`,
					width
				)
			)
		);
	}
	return rows.join('\n');
}

/**
 * `Delete task 3 and its 2 subtasks? This can't be undone.` Past one ID it
 * counts (`Delete 2 tasks and 5 subtasks?`), so the question fits one line
 */
export function formatRemovalQuestion({
	found,
	subtaskCount
}: TaskRemovalPreview): string {
	const name = (items: typeof found, noun: string) =>
		items.length === 1
			? `${noun} ${terminalSafe(items[0].id)}`
			: plural(items.length, noun);
	const tasks = found.filter((item) => !item.parent);
	// A subtask named with its own task is already in that task's count
	const named = found.filter(
		({ parent }) => parent && !tasks.some((task) => task.id === parent.id)
	);
	let what: string;
	if (tasks.length === 0) {
		what = name(named, 'subtask');
	} else {
		// With subtasks named too, one count of every subtask that goes
		const owner =
			named.length > 0 ? '' : tasks.length === 1 ? 'its ' : 'their ';
		const subtasks = named.length + subtaskCount;
		what =
			name(tasks, 'task') +
			(subtasks === 0
				? ''
				: ` and ${owner}${owner && subtasks === 1 ? 'subtask' : plural(subtasks, 'subtask')}`);
	}
	return `Delete ${what}? This can't be undone.`;
}

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
