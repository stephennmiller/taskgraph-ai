/**
 * @fileoverview What `update-task`, `update` and `update-subtask` changed, e.g.
 *
 *   ✓ Updated task 2  Build the login API
 *   Run taskgraph show 2 to see what changed
 *
 *   ✓ Added notes to subtask 1.1  Set up the parser
 *     Found that the CLI parser needs an alias table, so `ls` maps to
 *     `list` before the command runs.
 *
 *   ✓ Added a note to task 3  Store sessions in SQLite
 *
 *   ✓ Assigned task 3 to octocat  Store sessions in SQLite
 *
 *   ✓ Updated 3 tasks
 *     2  Build the login API
 *     3  Store sessions in SQLite
 *     4  Write the API docs
 *   Run taskgraph show <id> to see what changed
 *
 * They replace a boxed "Successfully appended…" message that repeated the
 * title under a "Title:" label, a boxed "Updating 3 tasks" heading over a
 * 95-column table, and a box explaining that done tasks can't be updated.
 */

import { sanitizeForTerminal } from '@tm/core';
import chalk from 'chalk';
import { terminalWidth } from '../layout/helpers.js';
import { theme } from '../theme.js';
import { formatResearchAnswer } from './research-formatters.js';

/** The task fields these confirmations show */
export interface UpdatedTaskRef {
	id: number | string;
	title: string;
}

const fit = (text: string, width: number) =>
	text.length > width ? `${text.slice(0, Math.max(1, width - 1))}…` : text;

/**
 * `✓ <lead>  <title>`, with the title cut to fit on one line (callers
 * pass it through sanitizeForTerminal first)
 */
function resultLine(lead: string, title: string, width: number): string {
	// "✓ " + lead + 2-space gap
	const titleWidth = Math.max(10, width - lead.length - 4);
	const oneLine = title.replace(/\s+/g, ' ');
	return `${chalk.green('✓')} ${lead}  ${fit(oneLine, titleWidth)}`;
}

/** `Run taskgraph show 2 to see what changed`, shortened for narrow terminals */
function showHint(id: number | string, width: number): string {
	const command = `taskgraph show ${id}`;
	const tail = ' to see what changed';
	const fits = `Run ${command}${tail}`.length <= width;
	return (
		theme.muted('Run ') + theme.brand(command) + (fits ? theme.muted(tail) : '')
	);
}

/**
 * Format the confirmation after `update-task` rewrote one task.
 *
 * @param task - The task as it is now
 * @param width - Terminal width; the title is cut to fit on one line
 */
export function formatTaskUpdated(
	task: UpdatedTaskRef,
	width = terminalWidth()
): string {
	task = sanitizeForTerminal(task);
	return [
		resultLine(`Updated task ${task.id}`, task.title, width),
		showHint(task.id, width)
	].join('\n');
}

/**
 * Format the confirmation after `update-task --assignee` set or cleared
 * who a task is for.
 *
 * @param assignee - The login now assigned; undefined when it was cleared
 */
export function formatAssigned(
	task: UpdatedTaskRef,
	assignee: string | undefined,
	width = terminalWidth()
): string {
	task = sanitizeForTerminal(task);
	const lead = assignee
		? `Assigned task ${task.id} to ${sanitizeForTerminal(assignee)}`
		: `Unassigned task ${task.id}`;
	return resultLine(lead, task.title, width);
}

/**
 * Format the confirmation after notes were appended to a task
 * (`update-task --append`) or a subtask (`update-subtask`).
 *
 * The notes are the text the AI wrote, without the `<info added on …>`
 * markers, rendered as markdown and indented under the result line.
 *
 * @param target - The task or subtask the notes were added to
 * @param notes - The text that was appended; empty when nothing was added
 * @param width - Terminal width; notes wrap to it, at most 100 columns
 */
export function formatNotesAdded(
	target: UpdatedTaskRef & { kind: 'task' | 'subtask' },
	notes: string,
	width = terminalWidth()
): string {
	target = sanitizeForTerminal(target);
	notes = sanitizeForTerminal(notes);
	const name = `${target.kind} ${target.id}`;
	if (!notes.trim()) {
		return `${chalk.yellow('⚠')} Nothing added to ${name}: the AI returned no text`;
	}

	// The markdown renderer wraps no narrower than 40 columns, so very narrow
	// terminals get the notes without the indent rather than a wrapped line
	const indent = width - 2 >= 40 ? '  ' : '';
	const body = formatResearchAnswer(notes, width - indent.length)
		.split('\n')
		.map((line) => (line ? `${indent}${line}` : line))
		.join('\n');
	return `${resultLine(`Added notes to ${name}`, target.title, width)}\n${body}`;
}

/**
 * Format the line `taskgraph note` prints once the note is saved. The note
 * isn't echoed: it was saved as typed, so showing it again says it twice.
 *
 * @param note - The task or subtask the note was added to
 * @param width - Terminal width; the title is cut to fit on one line
 */
export function formatNoteAdded(
	note: UpdatedTaskRef & { isSubtask: boolean },
	width = terminalWidth()
): string {
	note = sanitizeForTerminal(note);
	const kind = note.isSubtask ? 'subtask' : 'task';
	return resultLine(`Added a note to ${kind} ${note.id}`, note.title, width);
}

/**
 * Format the confirmation after `update --from=<id>` rewrote several tasks.
 *
 * @param tasks - The tasks that were changed, in order
 * @param width - Terminal width; titles are cut to fit on one line
 */
export function formatTasksUpdated(
	tasks: UpdatedTaskRef[],
	width = terminalWidth()
): string {
	tasks = sanitizeForTerminal(tasks);
	if (tasks.length === 0) {
		return 'No tasks changed: the AI returned none of the tasks it was sent';
	}
	if (tasks.length === 1) return formatTaskUpdated(tasks[0], width);

	const ids = tasks.map((task) => String(task.id));
	const idWidth = Math.max(...ids.map((id) => id.length));
	// 2-space indent, the ID, then a 2-space gap
	const titleWidth = Math.max(10, width - idWidth - 4);
	const lines = [`${chalk.green('✓')} Updated ${tasks.length} tasks`];
	tasks.forEach((task, index) => {
		lines.push(
			`  ${theme.brand(ids[index].padEnd(idWidth))}  ${fit(task.title, titleWidth)}`
		);
	});
	lines.push(showHint('<id>', width));
	return lines.join('\n');
}

/**
 * Format the line `update --from=<id>` prints when every task from that ID
 * on is done (or there are none).
 *
 * @param fromId - The --from value
 */
export function formatNothingToUpdate(fromId: number | string): string {
	return [
		`No tasks to update: none from ${fromId} on are unfinished`,
		theme.muted('Run ') +
			theme.brand('taskgraph list') +
			theme.muted(' to see task IDs')
	].join('\n');
}
