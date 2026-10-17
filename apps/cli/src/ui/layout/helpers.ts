/**
 * @fileoverview Layout helper utilities
 * Provides utilities for calculating dimensions, truncating text, and creating visual elements
 */

import chalk from 'chalk';

/**
 * Calculate box width as percentage of terminal width
 * @param percentage - Percentage of terminal width to use (default: 0.9)
 * @param minWidth - Minimum width to enforce (default: 40)
 * @returns Calculated box width
 */
export function getBoxWidth(
	percentage: number = 0.9,
	minWidth: number = 40
): number {
	const terminalWidth = process.stdout.columns || 80;
	return Math.max(Math.floor(terminalWidth * percentage), minWidth);
}

/**
 * Usable width for boxes and tables: 95% of the terminal, or 100 columns when
 * output is not a terminal (for example, piped to a file).
 */
export function getContentWidth(): number {
	const columns = process.stdout.columns;
	return columns ? Math.floor(columns * 0.95) : 100;
}

export interface ColumnSpec {
	key: string;
	/** Fixed width including cell padding, or 'flex' for the column that takes the remaining space (one per table) */
	width: number | 'flex';
	/** Optional columns are hidden in ascending dropOrder when the table does not fit */
	dropOrder?: number;
}

export interface ColumnPlan {
	keys: string[];
	widths: number[];
	hidden: string[];
}

/**
 * Fit table columns into a total width. Hides optional columns (lowest
 * dropOrder first) until the table fits, then gives the flexible column all
 * remaining space. Accounts for the vertical borders cli-table3 draws.
 */
export function planColumns(
	totalWidth: number,
	specs: ColumnSpec[],
	flexMin: number = 20
): ColumnPlan {
	const needed = (cols: ColumnSpec[]) =>
		cols.reduce((sum, c) => sum + (c.width === 'flex' ? flexMin : c.width), 0) +
		cols.length +
		1;

	let active = [...specs];
	const hidden: string[] = [];
	const droppable = specs
		.filter((c) => c.dropOrder !== undefined)
		.sort((a, b) => (a.dropOrder ?? 0) - (b.dropOrder ?? 0));

	for (const col of droppable) {
		if (needed(active) <= totalWidth) break;
		active = active.filter((c) => c !== col);
		hidden.push(col.key);
	}

	const fixedSum = active.reduce(
		(sum, c) => sum + (c.width === 'flex' ? 0 : c.width),
		0
	);
	const flexWidth = Math.max(
		flexMin,
		totalWidth - fixedSum - active.length - 1
	);

	return {
		keys: active.map((c) => c.key),
		widths: active.map((c) => (c.width === 'flex' ? flexWidth : c.width)),
		hidden
	};
}

/**
 * Truncate text to specified length
 */
export function truncate(text: string, maxLength: number): string {
	if (text.length <= maxLength) {
		return text;
	}
	return text.substring(0, maxLength - 3) + '...';
}

/**
 * Create a progress bar
 */
export function createProgressBar(
	completed: number,
	total: number,
	width: number = 30
): string {
	if (total === 0) {
		return chalk.gray('No tasks');
	}

	const percentage = Math.round((completed / total) * 100);
	const filled = Math.round((completed / total) * width);
	const empty = width - filled;

	const bar = chalk.green('█').repeat(filled) + chalk.gray('░').repeat(empty);

	return `${bar} ${chalk.cyan(`${percentage}%`)} (${completed}/${total})`;
}
