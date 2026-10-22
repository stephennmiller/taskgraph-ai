/**
 * @fileoverview Layout helper utilities
 * Provides utilities for calculating dimensions, truncating text, and creating visual elements
 */

import chalk from 'chalk';
import { theme } from '../theme.js';

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
	return Math.max(Math.floor(terminalWidth() * percentage), minWidth);
}

/** Largest width taken from `COLUMNS`, so a typo cannot crash padding with a huge repeat */
const MAX_ENV_COLUMNS = 1000;

/**
 * The width the user asked for, or undefined when nothing says: the stream's
 * own width when it is a terminal, else a positive integer in `COLUMNS`
 * (so `COLUMNS=120 taskgraph tags | less` still lays out at 120).
 */
function detectColumns(
	stream: { columns?: number } = process.stdout,
	env: NodeJS.ProcessEnv = process.env
): number | undefined {
	if (stream.columns && stream.columns > 0) return stream.columns;
	const fromEnv = env.COLUMNS?.trim();
	if (fromEnv && /^\d+$/.test(fromEnv)) {
		const columns = Number.parseInt(fromEnv, 10);
		if (columns > 0) return Math.min(columns, MAX_ENV_COLUMNS);
	}
	return undefined;
}

/**
 * Terminal width for laying out output: the stream's columns when it is a
 * terminal, else a positive integer from `COLUMNS`, else 80.
 */
export function terminalWidth(
	stream: { columns?: number } = process.stdout,
	env: NodeJS.ProcessEnv = process.env
): number {
	return detectColumns(stream, env) ?? 80;
}

/**
 * Usable width for boxes and tables: 95% of the terminal (or of `COLUMNS`),
 * or 100 columns when neither says (for example, piped to a file).
 */
export function getContentWidth(
	stream: { columns?: number } = process.stdout,
	env: NodeJS.ProcessEnv = process.env
): number {
	const columns = detectColumns(stream, env);
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
		return theme.muted('No tasks');
	}

	const percentage = Math.round((completed / total) * 100);
	const filled = Math.round((completed / total) * width);
	const empty = width - filled;

	const bar = chalk.green('█').repeat(filled) + theme.muted('░').repeat(empty);

	return `${bar} ${chalk.cyan(`${percentage}%`)} (${completed}/${total})`;
}
