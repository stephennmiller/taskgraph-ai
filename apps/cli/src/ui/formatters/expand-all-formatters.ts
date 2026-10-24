/**
 * @fileoverview What `expand --all` shows. While it works, one spinner for
 * the whole run (tasks are expanded a few at a time):
 *
 *   ⠼ Expanding 5 tasks · 2 done  0:31
 *
 * Each task's "✓ Added 3 subtasks to task 1" lines print as it finishes, and
 * the run ends with:
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
import { formatElapsed } from '../components/parse-prd-progress.component.js';
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

/**
 * The spinner text while `expand --all` runs.
 *
 * @param progress.total - Tasks being expanded
 * @param progress.done - Tasks finished so far, expanded, skipped or failed
 * @param progress.elapsedMs - Time since the run started
 */
export function formatExpandAllProgress(progress: {
	total: number;
	done: number;
	elapsedMs: number;
}): string {
	const { total, done, elapsedMs } = progress;
	const running = `Expanding ${plural(total, 'task')}`;
	// The first frame is also the one line a non-terminal run prints
	if (elapsedMs < 1000 && done === 0) return `${running}…`;
	const count = done > 0 ? theme.muted(` · ${done} done`) : '';
	return `${running}${count}  ${theme.muted(formatElapsed(elapsedMs))}`;
}
