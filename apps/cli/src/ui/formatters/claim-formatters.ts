/**
 * @fileoverview What `next --claim` prints, e.g.
 *
 *   ✓ Claimed task 2  Build the login API
 *     ▶ in-progress · assigned to steve
 *
 *   Next: taskgraph show 2
 *
 * Piped (an agent reading), the task lines sit between `<task-data>` and
 * `</task-data>`.
 *
 * and when nothing is ready:
 *
 *   Nothing ready to claim
 *   Run taskgraph list to see what's in progress or blocked
 */

import { formatTaskData, sanitizeForTerminal } from '@tm/core';
import chalk from 'chalk';
import { theme } from '../theme.js';
import { getStatusWithColor } from './status-formatters.js';

export interface ClaimSummary {
	taskId: string;
	title: string;
	claimedBy: string;
	/** The GitHub login the claim assigned the task to, if any */
	assignee?: string;
}

/** A session ID such as Claude Code's means nothing to a person reading */
const SESSION_ID =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Who has the task: the assignee, else a claimant that isn't a session ID */
function holder(claim: ClaimSummary): string {
	if (claim.assignee) return ` · assigned to ${claim.assignee}`;
	if (SESSION_ID.test(claim.claimedBy)) return '';
	return ` · claimed by ${claim.claimedBy}`;
}

const fit = (text: string, width: number) =>
	text.length > width ? `${text.slice(0, Math.max(0, width - 1))}…` : text;

/**
 * Format the result of a claim.
 *
 * @param claim - The claimed task, or null when nothing was ready
 * @param options.hasAnyTasks - Whether the tag has any tasks at all
 * @param options.width - Terminal width; defaults to 80
 * @param options.fence - Fence the task lines in `<task-data>`; default true
 */
export function formatClaim(
	claim: ClaimSummary | null,
	options: { hasAnyTasks: boolean; width?: number; fence?: boolean }
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
	const claimed = formatTaskData(
		[
			`${chalk.green('✓')} Claimed ${kind} ${theme.brand(claim.taskId)}  ${title}`,
			`  ${getStatusWithColor('in-progress')}${theme.muted(holder(claim))}`
		].join('\n'),
		options.fence ?? true
	);
	return `${claimed}\n\nNext: ${theme.brand(`taskgraph show ${claim.taskId}`)}`;
}
