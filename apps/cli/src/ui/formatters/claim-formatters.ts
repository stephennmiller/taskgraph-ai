/**
 * @fileoverview What `next --claim` prints, e.g.
 *
 *   <task-data>
 *   ✓ Claimed task 2  Build the login API
 *     ▶ in-progress · claimed by steve
 *   </task-data>
 *
 *   Next: taskgraph show 2
 *
 * and when nothing is ready:
 *
 *   Nothing ready to claim
 *   Run taskgraph list to see what's in progress or blocked
 */

import { fenceAsData, sanitizeForTerminal, TASK_DATA_TAG } from '@tm/core';
import chalk from 'chalk';
import { theme } from '../theme.js';
import { getStatusWithColor } from './status-formatters.js';

export interface ClaimSummary {
	taskId: string;
	title: string;
	claimedBy: string;
}

const fit = (text: string, width: number) =>
	text.length > width ? `${text.slice(0, Math.max(0, width - 1))}…` : text;

/**
 * Format the result of a claim.
 *
 * @param claim - The claimed task, or null when nothing was ready
 * @param options.hasAnyTasks - Whether the tag has any tasks at all
 * @param options.width - Terminal width; defaults to 80
 */
export function formatClaim(
	claim: ClaimSummary | null,
	options: { hasAnyTasks: boolean; width?: number }
): string {
	claim = sanitizeForTerminal(claim);
	if (!claim) {
		return options.hasAnyTasks
			? [
					'Nothing ready to claim',
					theme.muted(
						`Run ${theme.brand('taskgraph list')} to see what's in progress or blocked`
					)
				].join('\n')
			: [
					'No tasks to claim',
					theme.muted(
						`Create some with ${theme.brand('taskgraph parse-prd')} or ${theme.brand('taskgraph add-task')}`
					)
				].join('\n');
	}

	const width = options.width ?? 80;
	const kind = claim.taskId.includes('.') ? 'subtask' : 'task';
	const lead = `Claimed ${kind} ${claim.taskId}  `;
	const title = fit(claim.title, width - 2 - lead.length);
	// The title is task text, fenced as next and show fence it
	const claimed = fenceAsData(
		[
			`${chalk.green('✓')} Claimed ${kind} ${theme.brand(claim.taskId)}  ${title}`,
			`  ${getStatusWithColor('in-progress')} ${theme.muted(`· claimed by ${claim.claimedBy}`)}`
		].join('\n'),
		TASK_DATA_TAG
	);
	return `${claimed}\n\nNext: ${theme.brand(`taskgraph show ${claim.taskId}`)}`;
}
