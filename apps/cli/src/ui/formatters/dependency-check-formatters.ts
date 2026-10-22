/**
 * @fileoverview What `validate-dependencies` and `fix-dependencies` found, e.g.
 *
 *   ✓ No dependency problems · 4 tasks, 1 dependency
 *
 *   ✗ 2 dependency problems
 *     4  depends on task 99, which doesn't exist
 *     4  depends on itself
 *   Run taskgraph fix-dependencies to remove them
 *
 *   ✓ Fixed 2 dependency problems
 *     4  removed task 99, which doesn't exist
 *     4  removed its dependency on itself
 *   ✗ 2 problems left
 *     2  is part of a dependency loop
 *     3  is part of a dependency loop
 *   Break the loop with taskgraph remove-dependency --id=<id> --depends-on=<id>
 *
 * They replace boxed summaries, a log line per problem with the task ID
 * printed twice, and a self-dependency reported a second time as a loop.
 */

import chalk from 'chalk';
import { terminalWidth } from '../layout/helpers.js';
import { theme } from '../theme.js';

type Id = number | string;

/** One problem `validateTaskDependencies` reports */
export interface DependencyIssue {
	type: 'missing' | 'self' | 'circular';
	taskId: Id;
	dependencyId?: Id;
	/** For a loop: whether fix-dependencies can break it (subtasks only) */
	fixable?: boolean;
}

/** One change `fix-dependencies` made */
export interface DependencyFix {
	type: 'missing' | 'self' | 'duplicate' | 'circular';
	taskId: Id;
	dependencyId?: Id;
}

/** How much was checked, for the muted summary */
export interface DependencyCounts {
	taskCount: number;
	subtaskCount: number;
	dependencyCount: number;
}

const plural = (count: number, noun: string) =>
	`${count} ${count === 1 ? noun : `${noun}s`}`;

const fit = (text: string, width: number) =>
	text.length > width ? `${text.slice(0, Math.max(1, width - 1))}…` : text;

/** "task 3" or "subtask 3.2" */
const describeId = (id: Id) =>
	`${String(id).includes('.') ? 'subtask' : 'task'} ${id}`;

/** `4 tasks, 2 subtasks, 3 dependencies` */
function describeCounts({
	taskCount,
	subtaskCount,
	dependencyCount
}: DependencyCounts): string {
	const parts = [plural(taskCount, 'task')];
	if (subtaskCount > 0) parts.push(plural(subtaskCount, 'subtask'));
	parts.push(
		dependencyCount === 0
			? 'no dependencies'
			: dependencyCount === 1
				? '1 dependency'
				: `${dependencyCount} dependencies`
	);
	return parts.join(', ');
}

function describeIssue(issue: DependencyIssue): string {
	switch (issue.type) {
		case 'self':
			return 'depends on itself';
		case 'missing':
			return `depends on ${describeId(issue.dependencyId ?? '?')}, which doesn't exist`;
		case 'circular':
			return 'is part of a dependency loop';
	}
}

function describeFix(fix: DependencyFix): string {
	const dep = describeId(fix.dependencyId ?? '?');
	switch (fix.type) {
		case 'self':
			return 'removed its dependency on itself';
		case 'missing':
			return `removed ${dep}, which doesn't exist`;
		case 'duplicate':
			return `removed a duplicate of ${dep}`;
		case 'circular':
			return `removed ${dep} to break a loop`;
	}
}

/** Rows of `  <id>  <text>`, IDs aligned, text cut to the width */
function rows(
	items: Array<{ taskId: Id; text: string }>,
	width: number
): string[] {
	const idWidth = Math.max(...items.map((item) => String(item.taskId).length));
	const textWidth = Math.max(10, width - 4 - idWidth);
	return items.map(
		(item) =>
			`  ${theme.brand(String(item.taskId).padEnd(idWidth))}  ${fit(item.text, textWidth)}`
	);
}

/** Order by task, then subtask: 1, 1.1, 1.2, 2, 10. Stable within an ID */
function sortById<T extends { taskId: Id }>(items: T[]): T[] {
	const key = (id: Id) => String(id).split('.').map(Number);
	return [...items].sort((a, b) => {
		const [x, y] = [key(a.taskId), key(b.taskId)];
		for (let i = 0; i < Math.max(x.length, y.length); i++) {
			const diff = (x[i] ?? -1) - (y[i] ?? -1);
			if (diff !== 0) return diff;
		}
		return 0;
	});
}

function noProblems(counts: DependencyCounts): string {
	return `${chalk.green('✓')} No dependency problems${theme.muted(` · ${describeCounts(counts)}`)}`;
}

/**
 * Format the result of checking dependencies.
 *
 * @param result - The issues found and how much was checked
 * @param width - Terminal width; rows are cut to fit on one line
 */
export function formatDependencyCheck(
	result: DependencyCounts & { issues: DependencyIssue[] },
	width = terminalWidth()
): string {
	const { issues } = result;
	if (issues.length === 0) return noProblems(result);
	return problems(
		`${plural(issues.length, 'dependency problem')}`,
		issues,
		width
	);
}

/**
 * `✗ <heading>`, a row per issue, and how to fix them
 *
 * @param afterFix - fix-dependencies already ran, so what's left needs the
 *   user; suggesting it again would send them round in a circle
 */
function problems(
	heading: string,
	issues: DependencyIssue[],
	width: number,
	afterFix = false
): string {
	const lines = [
		`${chalk.red('✗')} ${heading}`,
		...rows(
			issues.map((issue) => ({
				taskId: issue.taskId,
				text: describeIssue(issue)
			})),
			width
		)
	];

	// fix-dependencies removes missing and self references and breaks loops
	// made only of subtasks; a loop through a task needs the user to pick an
	// edge
	const fixable =
		!afterFix &&
		issues.some((issue) => issue.type !== 'circular' || issue.fixable);
	lines.push(
		fixable
			? theme.muted('Run ') +
					theme.brand('taskgraph fix-dependencies') +
					theme.muted(' to remove them')
			: theme.muted('Break the loop with ') +
					theme.brand('taskgraph remove-dependency --id=<id> --depends-on=<id>')
	);

	return lines.join('\n');
}

/**
 * Format what fix-dependencies changed.
 *
 * @param result - The fixes made and how much was checked
 * @param width - Terminal width; rows are cut to fit on one line
 */
export function formatDependencyFixes(
	result: DependencyCounts & {
		fixes: DependencyFix[];
		/** Problems fix-dependencies leaves for the user, like task loops */
		remaining?: DependencyIssue[];
	},
	width = terminalWidth()
): string {
	const { fixes, remaining = [] } = result;
	if (fixes.length === 0 && remaining.length === 0) return noProblems(result);

	const lines: string[] = [];
	if (fixes.length > 0) {
		lines.push(
			`${chalk.green('✓')} Fixed ${plural(fixes.length, 'dependency problem')}`,
			...rows(
				sortById(fixes).map((fix) => ({
					taskId: fix.taskId,
					text: describeFix(fix)
				})),
				width
			)
		);
	}
	if (remaining.length > 0) {
		const heading =
			fixes.length > 0
				? `${plural(remaining.length, 'problem')} left`
				: plural(remaining.length, 'dependency problem');
		lines.push(problems(heading, remaining, width, true));
	}
	return lines.join('\n');
}
