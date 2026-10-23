/**
 * @fileoverview What `taskgraph list` prints around its task table, e.g.
 *
 *   Tasks     ███───▓▓▓▒▒▒░░░░░░!!  1 of 7 done · 14%
 *             ─ 1 deferred  ▓ 1 in progress  ▒ 1 review  ░ 2 pending  ! 1 blocked
 *   Subtasks  ███████░░░░░░░░░░░░░  1 of 3 done · 33%
 *             ░ 2 pending
 *   Ready     2 ready · 4 waiting on dependencies · task 3 unblocks 3
 *   Next      2.2  Sessions table and cookie middleware · high priority
 *
 *   ┌────┬───────── (the task table) ─────────┐
 *
 *   Next: taskgraph set-status --id=2.2 --status=in-progress to start working
 *
 * When stdout isn't a terminal (an agent or a script reading through a pipe),
 * `list` prints `formatPlainTaskList` instead: one line per task, full
 * titles, no color and no table:
 *
 *   1  done         high    Set up the database
 *   2  in-progress  high    Sign-in with sessions  deps:1
 *   3  pending      medium  Bookmark endpoints  deps:2
 *
 * It replaces two boxed dashboards (progress and priorities, dependency
 * metrics and next task), a boxed "Next task" card under the table that
 * repeated the dashboard's next task, and a boxed, numbered list of three
 * generic next steps.
 */

import {
	type InvalidDependency,
	TAG_NAME_PATTERN,
	fullSubtaskId,
	isTaskComplete,
	resolveSubtaskDependency,
	sanitizeForTerminal,
	stripTerminalControls,
	type Task
} from '@tm/core';
import chalk from 'chalk';
import {
	type TaskStatistics,
	calculateDependencyStatistics,
	calculateSubtaskStatistics,
	calculateTaskStatistics
} from '../components/dashboard.component.js';
import { terminalWidth } from '../layout/helpers.js';
import { getSuggestedActions } from '../suggested-actions.js';
import { theme } from '../theme.js';
import { fit, joinFacts, visibleLength } from './markdown-formatters.js';
import { getPriorityWithColor } from './priority-formatters.js';
import { formatNextStep } from './task-detail-formatters.js';

/** Rows fit the terminal, but no wider than this */
const MAX_WIDTH = 100;
/** Row labels (`Subtasks`) and the gap after them */
const LABEL_WIDTH = 10;
const BAR_MIN = 8;
const BAR_MAX = 20;

/**
 * One bar segment per status. Each has its own character as well as its own
 * color, so the bar reads without color; the counts line repeats the
 * characters as a legend.
 */
const SEGMENTS: Array<{
	name: string;
	glyph: string;
	paint: (text: string) => string;
	count: (stats: TaskStatistics) => number;
}> = [
	{
		name: 'done',
		glyph: '█',
		paint: chalk.green,
		// `completed` counts as done; cancelled has its own segment
		count: (stats) => stats.completedCount - stats.cancelled
	},
	{
		name: 'cancelled',
		glyph: '─',
		paint: theme.muted,
		count: (stats) => stats.cancelled
	},
	{
		name: 'deferred',
		glyph: '─',
		paint: theme.muted,
		count: (stats) => stats.deferred
	},
	{
		name: 'in progress',
		glyph: '▓',
		paint: theme.active,
		count: (stats) => stats.inProgress
	},
	{
		name: 'review',
		glyph: '▒',
		paint: chalk.magenta,
		count: (stats) => stats.review ?? 0
	},
	{
		name: 'pending',
		glyph: '░',
		paint: chalk.yellow,
		count: (stats) => stats.pending
	},
	{
		name: 'blocked',
		glyph: '!',
		paint: chalk.red,
		count: (stats) => stats.blocked
	}
];

export interface ListSummaryOptions {
	/** Terminal width */
	width?: number;
}

const resolveWidth = (width?: number) =>
	Math.max(30, Math.min(width ?? terminalWidth(), MAX_WIDTH));

const label = (text: string) => chalk.bold(text.padEnd(LABEL_WIDTH));
const indent = ' '.repeat(LABEL_WIDTH);

/** `███──▓▓▒░░!`, one segment per status, `width` characters long */
function progressBar(stats: TaskStatistics, width: number): string {
	const parts = SEGMENTS.map((segment) => ({
		...segment,
		n: segment.count(stats)
	})).filter((segment) => segment.n > 0);
	if (stats.total === 0 || parts.length === 0) {
		return theme.muted('░'.repeat(width));
	}

	let used = 0;
	const chars = parts.map((part) => {
		const n = Math.min(
			width - used,
			Math.round((part.n / stats.total) * width)
		);
		used += n;
		return n;
	});
	// Rounding can leave the bar a character short; give it to the last status
	chars[chars.length - 1] += width - used;

	return parts
		.map((part, i) => part.paint(part.glyph.repeat(Math.max(0, chars[i]))))
		.join('');
}

/**
 * `Tasks     ███──▓▓▒░░!  1 of 7 done · 14%` and, under it, the count of
 * each status that isn't done
 */
function progressRows(
	name: string,
	stats: TaskStatistics,
	width: number
): string[] {
	const done = `${stats.completedCount} of ${stats.total} done`;
	const percent = ` · ${stats.completionPercentage}%`;
	const barWidth = Math.max(
		BAR_MIN,
		Math.min(BAR_MAX, width - LABEL_WIDTH - 2 - done.length - percent.length)
	);
	const rows = [
		`${label(name)}${progressBar(stats, barWidth)}  ${theme.text(done)}${theme.muted(percent)}`
	];

	const counts = SEGMENTS.slice(1)
		.map((segment) => ({ segment, n: segment.count(stats) }))
		.filter(({ n }) => n > 0)
		.map(
			({ segment, n }) =>
				`${segment.paint(segment.glyph)} ${n} ${theme.muted(segment.name)}`
		);
	// The glyphs separate the counts, so two spaces will do
	rows.push(
		...joinFacts(counts, width - LABEL_WIDTH, '  ').map((line) => indent + line)
	);
	return rows;
}

/** `Ready     2 ready · 4 waiting on dependencies · task 3 unblocks 3` */
function readyRow(tasks: Task[], width: number): string[] {
	const deps = calculateDependencyStatistics(tasks);
	if (deps.tasksReadyToWork === 0 && deps.tasksBlockedByDeps === 0) return [];

	const facts = [`${deps.tasksReadyToWork} ready`];
	if (deps.tasksBlockedByDeps > 0) {
		facts.push(
			theme.muted(`${deps.tasksBlockedByDeps} waiting on dependencies`)
		);
	}
	// The task most others depend on, while it still holds them up
	const keyTask = tasks.find(
		(task) => String(task.id) === String(deps.mostDependedOnTaskId)
	);
	if (
		keyTask &&
		!isTaskComplete(keyTask.status) &&
		(deps.mostDependedOnCount ?? 0) > 1
	) {
		facts.push(
			theme.muted(`task ${keyTask.id} unblocks ${deps.mostDependedOnCount}`)
		);
	}
	return joinFacts(facts, width - LABEL_WIDTH).map(
		(line, i) => (i === 0 ? label('Ready') : indent) + line
	);
}

/** `Next      2.2  Sessions table and cookie middleware · high priority` */
function nextRow(next: Task | null | undefined, width: number): string {
	if (!next) {
		return label('Next') + theme.muted('nothing is ready to start');
	}
	const id = String(next.id);
	const title = next.title;
	const facts: string[] = [];
	if (next.priority) {
		facts.push(`${getPriorityWithColor(next.priority)} priority`);
	}
	if (typeof next.complexity === 'number') {
		facts.push(theme.muted(`complexity ${next.complexity}`));
	}
	const factText = facts.join(theme.muted(' · '));
	const factLength = facts.length ? visibleLength(` · ${factText}`) : 0;
	const room = width - LABEL_WIDTH - id.length - 2;
	// Keep the title readable: drop the facts before cutting it short
	const showFacts = facts.length > 0 && room - factLength >= 20;
	const titleText = fit(title, showFacts ? room - factLength : room);
	return (
		label('Next') +
		theme.brand(id) +
		'  ' +
		chalk.bold(titleText) +
		(showFacts ? theme.muted(' · ') + factText : '')
	);
}

/**
 * The summary `list` prints above its table: progress of tasks and
 * subtasks, how many are ready, and the task `next` picks.
 *
 * @param tasks - Every task in the tag, with subtasks, before any filter
 * @param next - What `taskgraph next` returns: a task or a subtask (`2.2`)
 */
export function formatListSummary(
	tasks: Task[],
	next: Task | null | undefined,
	options: ListSummaryOptions = {}
): string {
	tasks = sanitizeForTerminal(tasks);
	next = sanitizeForTerminal(next);
	const width = resolveWidth(options.width);
	const rows = progressRows('Tasks', calculateTaskStatistics(tasks), width);

	const subtaskStats = calculateSubtaskStatistics(tasks);
	if (subtaskStats.total > 0) {
		rows.push(...progressRows('Subtasks', subtaskStats, width));
	}

	rows.push(...readyRow(tasks, width));
	rows.push(nextRow(next, width));
	return rows.join('\n');
}

/**
 * The one `Next:` line under the table, for the task `next` picks; empty
 * when nothing is ready
 */
export function formatListNextStep(
	next: Task | null | undefined,
	options: ListSummaryOptions = {}
): string {
	next = sanitizeForTerminal(next);
	if (!next) return '';
	const [action] = getSuggestedActions(
		next.id,
		next.status,
		(next.subtasks?.length ?? 0) > 0
	);
	return formatNextStep(action, resolveWidth(options.width)).join('\n');
}

/**
 * What `list` says when no task matches: `No tasks found`, or
 * `No pending tasks found`, and how to get some
 *
 * @param filter - The status or view asked for (`pending`, `ready`), if any
 */
export function formatEmptyList(
	filter?: string,
	options: ListSummaryOptions = {}
): string {
	const width = resolveWidth(options.width);
	const message = filter ? `No ${filter} tasks found` : 'No tasks found';
	const action = filter
		? { command: 'taskgraph list', description: 'to see every task' }
		: {
				command: "taskgraph add-task --prompt='...'",
				description: 'to add one, or taskgraph parse-prd'
			};
	return [theme.text(message), ...formatNextStep(action, width)].join('\n');
}

/**
 * What `next` says when it has nothing to offer: no tasks at all, or none
 * ready to start
 */
export function formatNoNextTask(
	hasAnyTasks: boolean,
	options: ListSummaryOptions = {}
): string {
	if (!hasAnyTasks) return formatEmptyList(undefined, options);
	return [
		chalk.yellow(
			'All tasks are either completed, blocked by dependencies, or in progress'
		),
		...formatNextStep(
			{ command: 'taskgraph list', description: 'to see them all' },
			resolveWidth(options.width)
		)
	].join('\n');
}

/** A task as `list` holds it, with its tag when listing every tag */
type PlainListTask = Task & { tagName?: string };

interface PlainRow {
	tag?: string;
	id: string;
	status: string;
	priority: string;
	title: string;
	deps: string[];
}

/**
 * One line of text from a task file: line breaks, tabs and other whitespace
 * become single spaces (so `a\rb` stays two words), then escape sequences
 * and control characters are removed
 */
export const oneLine = (text: unknown) =>
	stripTerminalControls(String(text ?? ''), { singleLine: true });

/**
 * `list` for a pipe: one line per task (and per subtask with
 * `withSubtasks`), columns separated by two spaces and padded to line up,
 * full titles, and no ANSI codes, boxes or summary. A task's dependencies
 * end the line as `deps:1,2`. Subtasks get their full dotted ID (`2.1`).
 * When tasks carry a `tagName` (`--all-tags`), the tag is the first column.
 *
 * @param tasks - The rows `list` would put in its table
 */
export function formatPlainTaskList(
	tasks: PlainListTask[],
	options: { withSubtasks?: boolean } = {}
): string {
	const rows: PlainRow[] = [];
	for (const task of tasks) {
		const id = String(task.id);
		// Every field comes from the task file, so each goes through oneLine
		const tag = task.tagName === undefined ? undefined : oneLine(task.tagName);
		rows.push({
			tag,
			id: oneLine(id),
			status: oneLine(task.status),
			priority: oneLine(task.priority) || '-',
			title: oneLine(task.title) || '-',
			deps: (task.dependencies ?? []).map(oneLine)
		});
		if (!options.withSubtasks) continue;
		for (const subtask of task.subtasks ?? []) {
			rows.push({
				tag,
				id: oneLine(fullSubtaskId(id, subtask.id)),
				status: oneLine(subtask.status),
				priority: oneLine(subtask.priority) || '-',
				title: oneLine(subtask.title) || '-',
				deps: (subtask.dependencies ?? []).map((dep) =>
					oneLine(resolveSubtaskDependency(id, dep))
				)
			});
		}
	}

	const showTag = rows.some((row) => row.tag !== undefined);
	const widest = (pick: (row: PlainRow) => string) =>
		Math.max(...rows.map((row) => pick(row).length));
	const tagWidth = showTag ? widest((row) => row.tag ?? '-') : 0;
	const idWidth = widest((row) => row.id);
	const statusWidth = widest((row) => row.status);
	const priorityWidth = widest((row) => row.priority);

	return rows
		.map((row) =>
			[
				...(showTag ? [(row.tag ?? '-').padEnd(tagWidth)] : []),
				row.id.padEnd(idWidth),
				row.status.padEnd(statusWidth),
				row.priority.padEnd(priorityWidth),
				row.title,
				...(row.deps.length > 0 ? [`deps:${row.deps.join(',')}`] : [])
			].join('  ')
		)
		.join('\n');
}

/** How many invalid dependencies the warning names before `...and N more` */
const INVALID_DEPENDENCIES_SHOWN = 5;

/**
 * The warning `list` prints on stderr for dependencies on tasks that don't
 * exist. The IDs and tag come from the task file, so each goes through
 * oneLine, as in the plain lines (#366):
 *
 *   Warning: 1 invalid dependency reference(s) found:
 *     Task 3 depends on non-existent task 9
 *   Run taskgraph fix-dependencies to remove them
 *
 * @param invalidDependencies - From `buildBlocksMap`; must not be empty
 * @param tagName - The tag, when `list` was given one or every tag. The
 *   command names it only when add-tag would accept it, `<tag>` otherwise
 */
export function formatInvalidDependencyWarning(
	invalidDependencies: InvalidDependency[],
	tagName?: string
): string {
	const tag = tagName === undefined ? undefined : oneLine(tagName);
	const tagContext = tag === undefined ? '' : ` (tag: ${tag})`;
	const tagFlag =
		tagName === undefined
			? ''
			: ` --tag ${TAG_NAME_PATTERN.test(tagName) ? tagName : '<tag>'}`;
	const more = invalidDependencies.length - INVALID_DEPENDENCIES_SHOWN;
	return [
		chalk.yellow(
			`\nWarning: ${invalidDependencies.length} invalid dependency reference(s) found${tagContext}:`
		),
		...invalidDependencies
			.slice(0, INVALID_DEPENDENCIES_SHOWN)
			.map(({ taskId, depId }) =>
				theme.muted(
					`  Task ${oneLine(taskId)} depends on non-existent task ${oneLine(depId)}`
				)
			),
		...(more > 0 ? [theme.muted(`  ...and ${more} more`)] : []),
		theme.muted('Run ') +
			theme.brand(`taskgraph fix-dependencies${tagFlag}`) +
			theme.muted(' to remove them')
	].join('\n');
}
