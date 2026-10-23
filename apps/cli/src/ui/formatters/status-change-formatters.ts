/**
 * @fileoverview The confirmation after `set-status`, e.g.
 *
 *   ✓ Task 1  ○ pending → ▶ in-progress
 *
 * set-status runs many times a day, so the change gets one line rather than
 * a box. Several tasks get a count and one aligned line each.
 */

import { sanitizeForTerminal, type TaskStatus } from '@tm/core';
import chalk from 'chalk';
import { theme } from '../theme.js';
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
