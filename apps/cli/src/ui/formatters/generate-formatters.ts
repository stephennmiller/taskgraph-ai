/**
 * @fileoverview What `generate` wrote, e.g.
 *
 *   ✓ Generated 3 task files in .taskgraph/tasks · removed 1 orphaned file
 *
 * or, with nothing to write,
 *
 *   No tasks to generate files for; add one with taskgraph add-task
 *
 * It replaces three titled boxes (success, no tasks, failure).
 */

import path from 'node:path';
import type { GenerateTaskFilesResult } from '@tm/core';
import chalk from 'chalk';
import { theme } from '../theme.js';

const plural = (count: number, noun: string) =>
	`${count} ${count === 1 ? noun : `${noun}s`}`;

/** The output folder relative to the project, as the user would type it */
function relativeDir(directory: string, projectRoot: string): string {
	const relative = path.relative(projectRoot, directory);
	if (!relative) return '.';
	if (relative.startsWith('..') || path.isAbsolute(relative)) return directory;
	return relative.split(path.sep).join('/');
}

/** The one line `generate` prints when it succeeds */
export function formatGenerateResult(
	result: GenerateTaskFilesResult,
	projectRoot: string
): string {
	if (result.count === 0) {
		return (
			theme.text('No tasks to generate files for; add one with ') +
			theme.brand('taskgraph add-task')
		);
	}

	const orphans =
		result.orphanedFilesRemoved > 0
			? theme.muted(
					` · removed ${plural(result.orphanedFilesRemoved, 'orphaned file')}`
				)
			: '';
	return `${chalk.green('✓')} Generated ${plural(result.count, 'task file')} in ${relativeDir(result.directory, projectRoot)}${orphans}`;
}

/** The message and fix hint for `printError` when `generate` fails */
export function formatGenerateError(
	result: GenerateTaskFilesResult,
	projectRoot: string
): { message: string; hint: string } {
	const dir = relativeDir(result.directory, projectRoot);
	const hint = `Check that ${dir} is a folder you can write to`;
	const failed = Object.entries(result.fileErrors ?? {});
	if (failed.length > 0) {
		const [id, reason] = failed[0];
		const more = failed.length > 1 ? ` (and ${failed.length - 1} more)` : '';
		return {
			message: `Couldn't write ${plural(failed.length, 'task file')} to ${dir}: task ${id}: ${reason}${more}`,
			hint
		};
	}
	return {
		message: `Couldn't generate task files: ${result.error ?? 'unknown error'}`,
		hint
	};
}
