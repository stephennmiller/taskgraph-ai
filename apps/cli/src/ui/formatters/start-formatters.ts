/**
 * @fileoverview The lines `taskgraph start` prints around a Claude Code
 * session, e.g.
 *
 *   ▶ Starting subtask 2.2  Sessions table and cookie middleware
 *   Launching Claude Code…
 *
 *   (Claude Code runs)
 *
 *   ✓ Claude Code session ended
 *   Next: taskgraph set-status --id=2.2 --status=done when it is finished
 *
 * `start --dry-run` prints the task with formatTaskDetail instead. These
 * replace a green box with four numbered next steps after the session, and
 * boxed "Task not found!" and "Failed to launch" messages that hid why the
 * task couldn't start.
 */

import chalk from 'chalk';
import { terminalWidth } from '../layout/helpers.js';
import { theme } from '../theme.js';
import { fit, terminalSafe } from './markdown-formatters.js';
import { formatNextStep } from './task-detail-formatters.js';

/** The task or subtask being started: `{ id: '2.2', kind: 'subtask' }` */
export interface StartTarget {
	id: string;
	kind: 'task' | 'subtask';
}

/**
 * `▶ Starting subtask 2.2  Sessions table…`, then `Launching Claude Code…`
 */
export function formatStartLaunching(
	target: StartTarget,
	title: string,
	width = terminalWidth()
): string {
	const lead = `▶ Starting ${target.kind} ${target.id}`;
	const room = width - lead.length - 2;
	const name =
		room >= 10 ? `  ${chalk.bold(fit(terminalSafe(title), room))}` : '';
	return `${theme.active(lead)}${name}\n${theme.muted('Launching Claude Code…')}\n`;
}

/** `✓ Claude Code session ended` and how to mark the work done */
export function formatStartSessionEnded(
	id: string,
	width = terminalWidth()
): string {
	return [
		'',
		`${chalk.green('✓')} Claude Code session ended`,
		...formatNextStep(
			{
				command: `taskgraph set-status --id=${id} --status=done`,
				description: 'when it is finished'
			},
			width
		)
	].join('\n');
}

/**
 * Why a task couldn't start, and the fix, for `printError`
 *
 * @param id - The ID the user asked for (or `next` picked)
 * @param result - `found` and `error` from tm-core's start result
 */
export function formatStartFailed(
	id: string,
	result: { found: boolean; error?: string }
): { message: string; hint: string } {
	// The error can carry task titles and the ID as typed: keep terminal
	// control sequences in them from reaching the terminal
	const error =
		result.error === undefined ? undefined : terminalSafe(result.error);
	const safeId = terminalSafe(id);
	if (error?.startsWith('Conflicting tasks in progress')) {
		return {
			message: error.replace(
				'Conflicting tasks in progress',
				'Another task is in progress'
			),
			hint: `Run \`taskgraph start ${safeId} --force\` to start it anyway`
		};
	}
	if (!result.found) {
		return {
			message: error ?? `Task ${safeId} not found`,
			hint: 'Run `taskgraph list` to see task IDs'
		};
	}
	return {
		message: `Couldn't launch Claude Code for ${safeId}${error ? `: ${error}` : ''}`,
		hint: 'Check that the `claude` command is installed and on your PATH'
	};
}
