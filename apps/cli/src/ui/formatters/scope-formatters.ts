/**
 * @fileoverview What `scope-up` / `scope-down` changed, e.g.
 *
 *   ✓ Scoped up 2 tasks
 *     3  Add OAuth login with refresh tokens · 1 subtask kept, 5 new
 *     4  Rate-limit the login route
 */

import type { ScopeTaskResult } from '@tm/core';
import chalk from 'chalk';
import { theme } from '../theme.js';
import { terminalSafe } from './markdown-formatters.js';

const plural = (count: number, noun: string) =>
	`${count} ${count === 1 ? noun : `${noun}s`}`;

export function formatScopeResult(
	result: Pick<ScopeTaskResult, 'tasks'>,
	direction: 'up' | 'down'
): string {
	const lines = [
		`${chalk.green('✓')} Scoped ${direction} ${plural(result.tasks.length, 'task')}`
	];
	for (const scoped of result.tasks) {
		const subtasks = scoped.regenerated
			? theme.muted(
					` · ${plural(scoped.preserved, 'subtask')} kept, ${scoped.generated} new`
				)
			: '';
		lines.push(
			`  ${terminalSafe(scoped.task.id)}  ${terminalSafe(scoped.task.title)}${subtasks}`
		);
	}
	return lines.join('\n');
}
