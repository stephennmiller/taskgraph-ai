/**
 * @fileoverview The line `expand --all` ends with, after each task's own
 * "✓ Added 3 subtasks to task 1" lines, e.g.
 *
 *   ✓ Expanded 3 tasks · 1 skipped · 1 failed
 *   Next: taskgraph next
 *
 * It replaces a boxed "Expansion Summary" that listed attempted, expanded,
 * skipped and failed counts, zeros included. Every line is well under 60
 * columns, so it takes no width.
 */

import { sanitizeForTerminal } from '@tm/core';
import chalk from 'chalk';
import { theme } from '../theme.js';

export interface ExpandAllSummary {
	/** Tasks that got new subtasks */
	expandedCount: number;
	/** Tasks the complexity report said need no subtasks */
	skippedCount: number;
	/** Tasks whose expansion failed */
	failedCount: number;
	/** Tasks that were eligible (pending or in progress, and no subtasks unless --force) */
	tasksToExpand: number;
	/** Pending or in-progress tasks left out because they already have subtasks */
	alreadyExpandedCount?: number;
}

const plural = (count: number, noun: string) =>
	`${count} ${count === 1 ? noun : `${noun}s`}`;

/**
 * Format the result of expanding every pending task.
 *
 * @param summary - What expandAllTasks returned
 */
export function formatExpandAll(summary: ExpandAllSummary): string {
	summary = sanitizeForTerminal(summary);
	const {
		expandedCount,
		skippedCount,
		failedCount,
		tasksToExpand,
		alreadyExpandedCount = 0
	} = summary;

	if (tasksToExpand === 0) {
		if (alreadyExpandedCount === 0) return 'No pending tasks to expand';
		const have =
			alreadyExpandedCount === 1
				? '1 already has subtasks'
				: `${alreadyExpandedCount} already have subtasks`;
		return [
			`No pending tasks to expand: ${have}`,
			theme.muted('Add ') +
				theme.brand('--force') +
				theme.muted(' to replace their subtasks')
		].join('\n');
	}

	const skipped =
		skippedCount > 0 ? theme.muted(` · ${skippedCount} skipped`) : '';

	if (expandedCount === 0) {
		if (failedCount > 0) {
			return `${chalk.red('✗')} Couldn't expand ${plural(failedCount, 'task')}${skipped}`;
		}
		return [
			`No tasks expanded${theme.muted(` · ${skippedCount} skipped by the complexity report`)}`,
			theme.muted('Add ') +
				theme.brand('--num=<n>') +
				theme.muted(' to expand them anyway')
		].join('\n');
	}

	const failed =
		failedCount > 0
			? theme.muted(' · ') + chalk.red(`${failedCount} failed`)
			: '';
	return [
		`${chalk.green('✓')} Expanded ${plural(expandedCount, 'task')}${skipped}${failed}`,
		theme.muted('Next: ') + theme.brand('taskgraph next')
	].join('\n');
}
