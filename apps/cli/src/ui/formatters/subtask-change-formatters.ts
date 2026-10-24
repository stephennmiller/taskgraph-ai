/**
 * @fileoverview What `add-subtask` and `remove-subtask` changed, e.g.
 *
 *   ✓ Added subtask 1.3  Write the migration
 *     depends on 1.1
 *   Next: taskgraph set-status --id=1.3 --status=in-progress
 *
 *   ✓ Task 3 is now subtask 1.3  Write docs
 *   ✓ Removed subtask 1.1
 *   ✓ Subtask 1.2 is now task 4  Add indexes
 *
 * They replace green boxes headed "Subtask 1.3 Added Successfully" with the
 * title, status and dependencies as labelled lines and a numbered
 * "Next Steps" list.
 */

import chalk from 'chalk';
import { terminalWidth } from '../layout/helpers.js';
import { theme } from '../theme.js';
import { fit, terminalSafe, visibleLength } from './markdown-formatters.js';

export interface SubtaskRef {
	id: number | string;
	title: string;
	status?: string;
	dependencies?: Array<number | string>;
}

/** `✓ <lead>  <title>`, with the title cut to fit on one line */
function resultLine(lead: string, title: string, width: number): string {
	const head = `${chalk.green('✓')} ${lead}`;
	const room = width - visibleLength(head) - 2;
	return `${head}  ${fit(terminalSafe(title), Math.max(10, room))}`;
}

/**
 * What add-subtask did.
 *
 * @param fromTaskId - The task that was converted, for `--task-id`
 */
export function formatSubtaskAdded(
	parentId: number | string,
	subtask: SubtaskRef,
	fromTaskId?: number | string,
	width = terminalWidth()
): string {
	const id = `${parentId}.${subtask.id}`;
	if (fromTaskId !== undefined) {
		return resultLine(
			`Task ${fromTaskId} is now subtask ${id}`,
			subtask.title,
			width
		);
	}

	const lines = [resultLine(`Added subtask ${id}`, subtask.title, width)];
	const facts: string[] = [];
	if (subtask.status && subtask.status !== 'pending')
		facts.push(subtask.status);
	if (subtask.dependencies?.length) {
		facts.push(`depends on ${subtask.dependencies.join(', ')}`);
	}
	if (facts.length) lines.push(`  ${theme.muted(facts.join(' · '))}`);
	if (!subtask.status || subtask.status === 'pending') {
		lines.push(
			theme.muted('Next: ') +
				theme.brand(`taskgraph set-status --id=${id} --status=in-progress`)
		);
	}
	return lines.join('\n');
}

/**
 * What remove-subtask did to one subtask.
 *
 * @param convertedTo - The new task, for `--convert`
 */
export function formatSubtaskRemoved(
	subtaskId: string,
	convertedTo?: SubtaskRef | null,
	width = terminalWidth()
): string {
	// The ID is what the user typed, which parseInt read leniently
	const id = terminalSafe(subtaskId);
	if (!convertedTo) return `${chalk.green('✓')} Removed subtask ${id}`;
	return resultLine(
		`Subtask ${id} is now task ${convertedTo.id}`,
		convertedTo.title,
		width
	);
}
