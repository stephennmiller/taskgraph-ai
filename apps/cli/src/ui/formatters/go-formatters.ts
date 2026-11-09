/**
 * @fileoverview The line `taskgraph go` prints before loop when the project
 * already has work done or under way, e.g.
 *
 *   Resuming: 3 done, task 4 in progress, 3 pending
 *
 * On a first run (every task still pending) it prints nothing.
 */

import type { TaskStatus } from '@tm/core';
import { terminalSafe } from './markdown-formatters.js';

/**
 * @param byStatus Top-level task counts (TasksDomain.getStats)
 * @param inProgress The in-progress tasks and subtasks (getPrimeContext)
 * @returns The line, or null when nothing has started
 */
export function formatGoResume(
	byStatus: Partial<Record<TaskStatus, number>>,
	inProgress: ReadonlyArray<{ id: string }>
): string | null {
	const working =
		inProgress.length === 1
			? `task ${terminalSafe(inProgress[0].id)} in progress`
			: `${inProgress.length} in progress`;
	const started = [
		byStatus.done ? `${byStatus.done} done` : '',
		inProgress.length ? working : '',
		byStatus.review ? `${byStatus.review} in review` : '',
		byStatus.blocked ? `${byStatus.blocked} blocked` : ''
	].filter(Boolean);
	if (started.length === 0) return null;
	if (byStatus.pending) started.push(`${byStatus.pending} pending`);
	return `Resuming: ${started.join(', ')}`;
}
