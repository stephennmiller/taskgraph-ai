/**
 * @fileoverview Table display utilities
 * Provides table creation and formatting for tasks
 */

import { stripVTControlCharacters } from 'node:util';
import {
	isTaskComplete,
	sanitizeForTerminal,
	type Subtask,
	type Task,
	type TaskPriority
} from '@tm/core';
import chalk from 'chalk';
import Table from 'cli-table3';
import { getComplexityWithColor } from '../formatters/complexity-formatters.js';
import { getPriorityWithColor } from '../formatters/priority-formatters.js';
import { getStatusWithColor } from '../formatters/status-formatters.js';
import {
	type ColumnSpec,
	getContentWidth,
	planColumns,
	truncate,
	wrapLine
} from '../layout/helpers.js';
import { TABLE_BORDER, theme } from '../theme.js';

/**
 * Default priority for tasks/subtasks when not specified
 */
const DEFAULT_PRIORITY: TaskPriority = 'medium';

/**
 * Task-like object that can optionally have blocks field and tag name
 * Used for table display - accepts both enriched TaskWithBlocks and regular Task/Subtask
 */
type TaskTableItem = (Task | Subtask) & {
	blocks?: string[];
	tagName?: string;
};

/**
 * Table columns in display order. Optional columns are hidden, lowest
 * dropOrder first, when the terminal is too narrow to show them all.
 * Tag and ID widths here are maximums.
 */
const TASK_TABLE_COLUMNS: (ColumnSpec & { header: string })[] = [
	// Never dropped: the column only shows when requested, and IDs repeat across tags
	{ key: 'tag', header: 'Tag', width: 12 },
	{ key: 'id', header: 'ID', width: 10 },
	{ key: 'title', header: 'Title', width: 'flex' },
	{ key: 'status', header: 'Status', width: 15 },
	{ key: 'priority', header: 'Priority', width: 10, dropOrder: 4 },
	{ key: 'dependencies', header: 'Dependencies', width: 14, dropOrder: 3 },
	{ key: 'blocks', header: 'Blocks', width: 10, dropOrder: 0 },
	{ key: 'complexity', header: 'Complexity', width: 12, dropOrder: 1 }
];

/**
 * Create a task table for display
 */
export function createTaskTable(
	tasks: TaskTableItem[],
	options?: {
		showSubtasks?: boolean;
		showComplexity?: boolean;
		showDependencies?: boolean;
		showBlocks?: boolean;
		/** Hide the Blocks column last, as when the list is filtered on it */
		keepBlocks?: boolean;
		showTag?: boolean;
	}
): string {
	tasks = sanitizeForTerminal(tasks);
	const {
		showSubtasks = false,
		showComplexity = false,
		showDependencies = true,
		showBlocks = false,
		keepBlocks = false,
		showTag = false
	} = options || {};

	// A column of N/A only costs width, so show Complexity when some row has a score
	const hasComplexity = tasks.some(
		(t) =>
			typeof t.complexity === 'number' ||
			(showSubtasks &&
				(t.subtasks ?? []).some((s) => typeof s.complexity === 'number'))
	);
	const requested: Record<string, boolean> = {
		tag: showTag,
		dependencies: showDependencies,
		blocks: showBlocks,
		complexity: showComplexity && hasComplexity
	};
	// Tag and ID fit their widest value (plus cell padding), up to the default width
	const fitTo: Record<string, string[]> = {
		tag: tasks.map((t) => t.tagName || '-'),
		id: tasks.flatMap((t) => [
			String(t.id),
			...(showSubtasks ? (t.subtasks ?? []) : []).map((s) => ` └─ ${s.id}`)
		])
	};
	const specs = TASK_TABLE_COLUMNS.filter(
		(col) => requested[col.key] ?? true
	).map((col) => {
		// Hide Blocks last, not never: below about 47 columns it can't fit
		if (col.key === 'blocks' && keepBlocks) return { ...col, dropOrder: 5 };
		const values = fitTo[col.key];
		if (!values) return col;
		const widest = Math.max(col.header.length, ...values.map((v) => v.length));
		return { ...col, width: Math.min(widest + 2, col.width as number) };
	});
	const plan = planColumns(getContentWidth(), specs);
	const width = (key: string) => plan.widths[plan.keys.indexOf(key)];

	const table = new Table({
		head: plan.keys.map((key) =>
			theme.brand.bold(
				TASK_TABLE_COLUMNS.find((col) => col.key === key)?.header ?? key
			)
		),
		style: { head: [], border: TABLE_BORDER },
		colWidths: plan.widths,
		wordWrap: true
	});

	const pick = (cells: Record<string, string>) =>
		plan.keys.map((key) => cells[key] ?? '');

	tasks.forEach((task) => {
		const blocksText = task.blocks?.join(', ') ?? '';
		table.push(
			pick({
				// Tag goes first when showing all tags
				tag: theme.accent(task.tagName || '-'),
				id: chalk.cyan(task.id.toString()),
				// The width includes one space of cell padding on each side
				title: truncate(task.title, width('title') - 2),
				status: getStatusWithColor(task.status, true), // Use table version
				priority: getPriorityWithColor(task.priority),
				// For table display, show simple format without status icons
				dependencies:
					!task.dependencies || task.dependencies.length === 0
						? theme.muted('-')
						: chalk.cyan(task.dependencies.map((d) => String(d)).join(', ')),
				// Gray out blocks for completed tasks (no longer blocking)
				blocks: !blocksText
					? theme.muted('-')
					: isTaskComplete(task.status)
						? theme.muted(blocksText)
						: chalk.yellow(blocksText),
				// Show complexity score from report if available
				complexity:
					typeof task.complexity === 'number'
						? getComplexityWithColor(task.complexity)
						: theme.muted('N/A')
			})
		);

		// Add subtasks if requested
		if (showSubtasks && task.subtasks && task.subtasks.length > 0) {
			task.subtasks.forEach((subtask) => {
				table.push(
					pick({
						// Subtasks inherit parent's tag, just show dash
						tag: theme.muted('-'),
						id: theme.muted(` └─ ${subtask.id}`),
						title: theme.muted(truncate(subtask.title, width('title') - 2)),
						status: theme.muted(getStatusWithColor(subtask.status, true)),
						priority: theme.muted(subtask.priority || DEFAULT_PRIORITY),
						dependencies: theme.muted(
							subtask.dependencies && subtask.dependencies.length > 0
								? subtask.dependencies.map((dep) => String(dep)).join(', ')
								: '-'
						),
						// Subtasks don't typically have blocks, show dash
						blocks: theme.muted('-'),
						complexity: theme.muted(
							typeof subtask.complexity === 'number'
								? getComplexityWithColor(subtask.complexity)
								: '--'
						)
					})
				);
			});
		}
	});

	// Say which columns were hidden, so narrow terminals never lose data silently
	const hiddenNote =
		plan.hidden.length > 0
			? '\n' +
				wrapLine(
					`Hidden to fit width: ${plan.hidden
						.map(
							(key) => TASK_TABLE_COLUMNS.find((col) => col.key === key)?.header
						)
						.join(', ')}`,
					getContentWidth(),
					''
				)
					.map((line) => theme.muted(line))
					.join('\n')
			: '';

	// Keep the rule under the one-line header (line 2) and drop the ones
	// between body rows, which double the table's height
	const rendered = table
		.toString()
		.split('\n')
		.filter(
			(line, i) => i === 2 || !stripVTControlCharacters(line).startsWith('├')
		)
		.join('\n');

	return rendered + hiddenNote;
}
