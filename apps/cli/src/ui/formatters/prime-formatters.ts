/**
 * @fileoverview `taskgraph prime`: session context for a coding agent, e.g.
 *
 *   TaskGraph tracks work in this project · tag master · 4 of 12 tasks done
 *
 *   In progress
 *     3.2  Add the login endpoint · in Auth
 *          Done when:
 *          - Returns 401 on a bad password
 *
 *   Ready next
 *     3.4  Rate limit the endpoint · in Auth
 *     5    Build the settings page
 *
 *   Rules
 *     1. Claim a task before you start it
 *        taskgraph set-status --id=<id> --status=in-progress
 *     …
 *     Keep free text in single quotes, and write ' in it as '\''.
 *
 *   Next: taskgraph show <id> for a task's full details
 *
 * A plugin hook runs it at session start and after compaction, so the output
 * lands in the agent's context: short (under 40 lines), plain when piped, and
 * no wider than the terminal (80 columns when there isn't one).
 */

import {
	type PrimeContext,
	type PrimeTask,
	sanitizeForTerminal
} from '@tm/core';
import { theme } from '../theme.js';

const INDENT = '  ';
/** Most lines of done-when text before pointing at `show`, shared by the tasks shown */
const MAX_DONE_WHEN_LINES = 6;
/** Most lines one criterion may wrap to */
const MAX_LINES_PER_CRITERION = 3;
/** Most in-progress tasks shown in full, so the output stays under 40 lines */
const MAX_IN_PROGRESS = 2;

const cut = (text: string, width: number) =>
	text.length > width ? `${text.slice(0, Math.max(1, width - 1))}…` : text;

const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim();

/** Word-wrap to `width`, keeping at most `maxLines` (the last one cut with …) */
function wrap(text: string, width: number, maxLines: number): string[] {
	const lines: string[] = [];
	let line = '';
	for (const word of oneLine(text).split(' ')) {
		if (!line) line = word;
		else if (line.length + 1 + word.length <= width) line += ` ${word}`;
		else {
			lines.push(line);
			line = word;
		}
	}
	if (line) lines.push(line);
	if (lines.length <= maxLines) return lines.map((l) => cut(l, width));
	const kept = lines.slice(0, maxLines);
	kept[maxLines - 1] = cut(`${kept[maxLines - 1]} …`, width);
	return kept.map((l) => cut(l, width));
}

/** `3.2  Title · in Parent`, cut to fit `width` */
function taskRow(task: PrimeTask, idWidth: number, width: number): string {
	const id = task.id.padEnd(idWidth);
	const parent = task.parentTitle ? ` · in ${oneLine(task.parentTitle)}` : '';
	const room = width - INDENT.length - idWidth - 2;
	const title = oneLine(task.title);
	if (title.length + parent.length <= room) {
		return `${INDENT}${theme.brand(id)}  ${title}${theme.muted(parent)}`;
	}
	// Cut the parent first, then the title
	const titleRoom = Math.max(10, room - Math.min(parent.length, 20));
	const shownTitle = cut(title, titleRoom);
	const shownParent = parent
		? cut(parent, Math.max(0, room - shownTitle.length))
		: '';
	return `${INDENT}${theme.brand(id)}  ${shownTitle}${theme.muted(shownParent)}`;
}

/**
 * Format the prime context.
 *
 * @param width - Terminal width; titles are cut and criteria wrapped to fit
 */
export function formatPrimeContext(
	context: PrimeContext,
	width = process.stdout.columns || 80
): string {
	context = sanitizeForTerminal(context);
	const { counts } = context;
	const lines = [
		`TaskGraph tracks work in this project ${theme.muted(
			`· tag ${context.tag} · ${counts.done} of ${counts.total} ${
				counts.total === 1 ? 'task' : 'tasks'
			} done`
		)}`
	];

	if (counts.total === 0) {
		lines.push(
			'',
			'No tasks yet. Add some with:',
			`${INDENT}${theme.brand('taskgraph parse-prd <file>')}${theme.muted(' or ')}${theme.brand("taskgraph add-task --prompt='<task>'")}`
		);
	} else {
		lines.push('', ...formatInProgress(context, width));
		lines.push('', ...formatReady(context, width));
	}

	lines.push('', theme.heading('Rules'));
	context.rules.forEach((rule, i) => {
		const number = `${i + 1}. `;
		const pad = ' '.repeat(number.length);
		lines.push(
			`${INDENT}${number}${cut(rule.text, width - INDENT.length - number.length)}`,
			`${INDENT}${pad}${theme.brand(cut(rule.command, width - INDENT.length - pad.length))}`
		);
	});
	lines.push(
		`${INDENT}${theme.muted("Keep free text in single quotes, and write ' in it as '\\''.")}`
	);

	if (counts.total > 0) {
		lines.push(
			'',
			`${theme.muted('Next:')} ${theme.brand('taskgraph show <id>')} ${theme.muted('for a task’s full details')}`
		);
	}

	return lines.join('\n');
}

function formatInProgress(context: PrimeContext, width: number): string[] {
	if (context.inProgress.length === 0) {
		return [
			theme.muted(
				context.ready.length > 0
					? 'Nothing in progress. Claim a ready task first.'
					: 'Nothing in progress.'
			)
		];
	}

	const shownTasks = context.inProgress.slice(0, MAX_IN_PROGRESS);
	const idWidth = Math.max(...shownTasks.map((t) => t.id.length));
	const sub = INDENT + ' '.repeat(idWidth + 2);
	const textWidth = width - sub.length - 2;
	const lines = [theme.heading('In progress')];
	const maxDoneWhenLines = Math.floor(MAX_DONE_WHEN_LINES / shownTasks.length);

	for (const task of shownTasks) {
		lines.push(taskRow(task, idWidth, width));
		if (task.doneWhen.length === 0) {
			lines.push(
				`${sub}${theme.muted('No done-when criteria. Ask, or add a test strategy.')}`
			);
			continue;
		}
		lines.push(`${sub}${theme.muted('Done when:')}`);
		let used = 0;
		let shown = 0;
		for (const criterion of task.doneWhen) {
			const wrapped = wrap(criterion, textWidth, MAX_LINES_PER_CRITERION);
			if (used + wrapped.length > maxDoneWhenLines) break;
			wrapped.forEach((line, i) => {
				lines.push(`${sub}${i === 0 ? '- ' : '  '}${line}`);
			});
			used += wrapped.length;
			shown++;
		}
		const hidden = task.doneWhen.length - shown;
		if (hidden > 0) {
			lines.push(
				`${sub}${theme.muted(cut(`${hidden} more: taskgraph show ${task.id}`, textWidth + 2))}`
			);
		}
	}
	const notShown = context.inProgress.length - shownTasks.length;
	if (notShown > 0) {
		lines.push(
			`${INDENT}${theme.muted(cut(`${notShown} more in progress: taskgraph list --status=in-progress`, width - INDENT.length))}`
		);
	}
	return lines;
}

function formatReady(context: PrimeContext, width: number): string[] {
	if (context.ready.length === 0) {
		const allDone = context.counts.done === context.counts.total;
		return [
			theme.muted(
				allDone
					? 'All tasks are done.'
					: 'Nothing else is ready. See what blocks it: taskgraph graph'
			)
		];
	}
	const idWidth = Math.max(...context.ready.map((t) => t.id.length));
	return [
		theme.heading('Ready next'),
		...context.ready.map((task) => taskRow(task, idWidth, width))
	];
}

/**
 * The end-of-session reminder (`prime --unnoted-since`), which the plugin's
 * Stop hook hands to Claude once per session, e.g.
 *
 *   Task 3.2 is still in progress with no note from this session.
 *   If you worked on it, log what you did (write ' as '\''):
 *     taskgraph note 3.2 '<what you did or decided>'
 *   If it's finished, check its criteria and close it:
 *     taskgraph set-status --id=3.2 --status=done
 *   If you didn't work on it, say so in one line and stop.
 *
 * IDs only, no titles: Claude already has them from prime, and it keeps the
 * reminder to a fixed shape.
 */
export function formatUnnotedReminder(tasks: PrimeTask[]): string {
	tasks = sanitizeForTerminal(tasks);
	const ids = tasks.map((t) => t.id);
	const one = ids.length === 1;
	const id = one ? ids[0] : '<id>';
	const list = one
		? `Task ${ids[0]} is`
		: `Tasks ${ids.slice(0, -1).join(', ')} and ${ids[ids.length - 1]} are`;
	return [
		`${list} still in progress with no note from this session.`,
		`If you worked on ${one ? 'it' : 'one'}, log what you did (write ' as '\\''):`,
		`${INDENT}${theme.brand(`taskgraph note ${id} '<what you did or decided>'`)}`,
		`If ${one ? "it's" : 'one is'} finished, check its criteria and close it:`,
		`${INDENT}${theme.brand(`taskgraph set-status --id=${id} --status=done`)}`,
		`If you didn't work on ${one ? 'it' : 'them'}, say so in one line and stop.`
	].join('\n');
}
