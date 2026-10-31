/**
 * @fileoverview The confirmation after `set-status`, e.g.
 *
 *   ✓ Task 1  ○ pending → ▶ in-progress
 *
 * set-status runs many times a day, so the change gets one line rather than
 * a box. Several tasks get a count and one aligned line each. Marking a task
 * done adds what it made ready and the next step:
 *
 *   ✓ Task 2  ○ pending → ✓ done
 *     Ready now  3  Write the login page
 *                5  Add logout endpoint
 *   Next: taskgraph next
 */

import {
	type ReadyTask,
	sanitizeForTerminal,
	TAG_NAME_PATTERN,
	type TaskStatus
} from '@tm/core';
import chalk from 'chalk';
import { terminalWidth } from '../layout/helpers.js';
import { theme } from '../theme.js';
import { fit, terminalSafe } from './markdown-formatters.js';
import { getStatusWithColor } from './status-formatters.js';

/** One task's status change */
export interface StatusChange {
	taskId: string;
	oldStatus: TaskStatus;
	newStatus: TaskStatus;
}

const transition = (change: StatusChange) =>
	change.oldStatus === change.newStatus
		? `${getStatusWithColor(change.newStatus)} ${theme.muted('(unchanged)')}`
		: `${getStatusWithColor(change.oldStatus)} → ${getStatusWithColor(change.newStatus)}`;

/**
 * Format the result of a status update.
 *
 * @param changes - The tasks that were updated, in order
 */
export function formatStatusChanges(changes: StatusChange[]): string {
	changes = sanitizeForTerminal(changes);
	const check = chalk.green('✓');
	if (changes.length === 1) {
		const [change] = changes;
		return `${check} Task ${theme.brand(change.taskId)}  ${transition(change)}`;
	}

	const idWidth = Math.max(0, ...changes.map((c) => c.taskId.length));
	return [
		`${check} Updated ${changes.length} tasks`,
		...changes.map(
			(change) =>
				`  ${theme.brand(change.taskId.padEnd(idWidth))}  ${transition(change)}`
		)
	].join('\n');
}

/**
 * The lines after a task reached done: the tasks and subtasks it made ready,
 * IDs aligned and titles cut to the width, then the next step. A `--tag`
 * write gets `next --tag` so the step reads the same tag.
 */
export function formatReadyAfterDone(
	ready: ReadyTask[],
	width = terminalWidth(),
	tag?: string
): string {
	const label = 'Ready now';
	const idWidth = Math.max(0, ...ready.map((t) => terminalSafe(t.id).length));
	const room = width - (2 + label.length + 2 + idWidth + 2);
	const rows = ready.map(
		(task, i) =>
			`  ${theme.muted(i === 0 ? label : ' '.repeat(label.length))}  ` +
			`${theme.brand(terminalSafe(task.id).padEnd(idWidth))}  ` +
			fit(terminalSafe(task.title), Math.max(10, room))
	);
	const tagFlag =
		tag === undefined
			? ''
			: ` --tag ${TAG_NAME_PATTERN.test(tag) ? tag : '<tag>'}`;
	return [
		...rows,
		theme.muted('Next: ') + theme.brand(`taskgraph next${tagFlag}`)
	].join('\n');
}
