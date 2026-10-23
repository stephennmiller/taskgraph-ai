/**
 * @fileoverview What `archive` and `archive restore` print, e.g.
 *
 *   ✓ Archived 3 tasks done or cancelled 30+ days ago: 3, 5, 9
 *
 *   Would archive 2 tasks done or cancelled 30+ days ago
 *     3  ✓ done       Set up the database schema
 *     5  x cancelled  Build the login API
 *   Run taskgraph archive to move them
 *
 *   No tasks done or cancelled 30+ days ago; nothing archived
 *
 *   ✓ Restored task 5  Build the login API
 */

import { sanitizeForTerminal, type TaskStatus } from '@tm/core';
import chalk from 'chalk';
import { theme } from '../theme.js';
import { getStatusIcon } from './status-formatters.js';

export interface ArchivedTaskRow {
	id: string;
	title: string;
	status: string;
}

export interface ArchiveSummary {
	tasks: ArchivedTaskRow[];
	olderThanDays: number;
	dryRun: boolean;
}

const fit = (text: string, width: number) =>
	text.length > width ? `${text.slice(0, Math.max(1, width - 1))}…` : text;

const plural = (count: number, word: string) =>
	`${count} ${word}${count === 1 ? '' : 's'}`;

/** "done or cancelled 30+ days ago", or just "done or cancelled" for 0 days */
function finishedPhrase(days: number): string {
	if (days <= 0) return 'done or cancelled';
	return `done or cancelled ${days}+ ${days === 1 ? 'day' : 'days'} ago`;
}

/**
 * Format the result of `archive`. A real run is one line; a dry run lists
 * the tasks it would move, since that's what you're checking.
 *
 * @param width - Terminal width; defaults to 80
 */
export function formatArchiveResult(
	summary: ArchiveSummary,
	width = 80
): string {
	summary = sanitizeForTerminal(summary);
	const { tasks, olderThanDays, dryRun } = summary;
	const finished = finishedPhrase(olderThanDays);

	if (tasks.length === 0) {
		return `No tasks ${finished}; nothing ${dryRun ? 'to archive' : 'archived'}`;
	}

	if (!dryRun) {
		const lead = `✓ Archived ${plural(tasks.length, 'task')} ${finished}: `;
		const ids = fit(tasks.map((t) => t.id).join(', '), width - lead.length);
		return `${chalk.green('✓')}${lead.slice(1)}${theme.brand(ids)}`;
	}

	const idWidth = Math.max(...tasks.map((t) => t.id.length));
	const statusWidth = Math.max(...tasks.map((t) => t.status.length));
	const titleWidth = Math.max(10, width - 2 - idWidth - 4 - statusWidth - 2);
	return [
		`Would archive ${plural(tasks.length, 'task')} ${finished}`,
		...tasks.map(
			(t) =>
				`  ${theme.brand(t.id.padEnd(idWidth))}  ${getStatusIcon(t.status as TaskStatus)} ${theme.muted(t.status.padEnd(statusWidth))}  ${fit(t.title, titleWidth)}`
		),
		theme.muted(`Run ${theme.brand('taskgraph archive')} to move them`)
	].join('\n');
}

/**
 * Format the result of `archive restore`
 *
 * @param width - Terminal width; defaults to 80
 */
export function formatRestoreResult(
	task: { id: string; title: string },
	width = 80
): string {
	task = sanitizeForTerminal(task);
	const lead = `✓ Restored task ${task.id}  `;
	return `${chalk.green('✓')} Restored task ${theme.brand(task.id)}  ${fit(task.title, width - lead.length)}`;
}
