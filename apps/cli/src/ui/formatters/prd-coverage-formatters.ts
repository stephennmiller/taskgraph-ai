/**
 * @fileoverview Which PRD sections have tasks, printed by
 * `validate-dependencies` under the dependency result once parse-prd has
 * recorded where tasks came from, e.g.
 *
 *   ✓ Every PRD section has a task · 10 sections in docs/prd.md
 *
 *   ⚠ 3 of 10 PRD sections have no task · docs/prd.md
 *     #search--tags   Search & Tags
 *     #rate-limiting  Rate limiting
 *   ⚠ 1 task cites a heading docs/prd.md no longer has
 *     3  #password-reset
 *   ⚠ 1 task has no PRD section
 *     6  Write release notes
 */

import type { PrdCoverage, PrdFileCoverage } from '@tm/core';
import chalk from 'chalk';
import { terminalWidth } from '../layout/helpers.js';
import { theme } from '../theme.js';
import { fit, terminalSafe } from './markdown-formatters.js';

type Id = number | string;

const plural = (count: number, noun: string) =>
	`${count} ${count === 1 ? noun : `${noun}s`}`;

const warn = (text: string) => `${chalk.yellow('⚠')} ${text}`;

/** `1`, `1 and 3`, `1, 3 and 4` */
const listIds = (ids: Id[]) =>
	ids.length <= 1
		? ids.join('')
		: `${ids.slice(0, -1).join(', ')} and ${ids.at(-1)}`;

/** Aligned `  <key>  <text>` rows, cut to the width */
function rows(
	items: Array<{ key: string; text: string }>,
	width: number
): string[] {
	const keyWidth = Math.max(...items.map((item) => item.key.length));
	const textWidth = Math.max(10, width - 4 - keyWidth);
	return items.map(
		(item) =>
			`  ${theme.brand(item.key.padEnd(keyWidth))}  ${fit(item.text, textWidth)}`
	);
}

function fileLines(file: PrdFileCoverage, width: number): string[] {
	const prd = terminalSafe(file.path);
	if (file.missing) {
		const cite = file.taskIds.length === 1 ? 'cites' : 'cite';
		return [
			warn(
				`Can't read ${prd}, which ${file.taskIds.length === 1 ? 'task' : 'tasks'} ${listIds(file.taskIds.map(terminalSafe))} ${cite}`
			)
		];
	}

	const lines: string[] = [];
	if (file.uncovered.length > 0) {
		lines.push(
			warn(
				`${file.uncovered.length} of ${plural(file.sectionCount, 'PRD section')} ${file.uncovered.length === 1 ? 'has' : 'have'} no task`
			) + theme.muted(` · ${prd}`),
			...rows(
				file.uncovered.map((section) => ({
					key: `#${terminalSafe(section.slug)}`,
					text: terminalSafe(section.title)
				})),
				width
			)
		);
	}
	if (file.stale.length > 0) {
		lines.push(
			warn(
				`${plural(file.stale.length, 'task')} ${file.stale.length === 1 ? 'cites a heading' : 'cite headings'} ${prd} no longer has`
			),
			...rows(
				file.stale.map((stale) => ({
					key: terminalSafe(stale.taskId),
					text: `#${terminalSafe(stale.slug)}`
				})),
				width
			)
		);
	}
	if (lines.length === 0) {
		lines.push(
			`${chalk.green('✓')} Every PRD section has a task` +
				theme.muted(` · ${plural(file.sectionCount, 'section')} in ${prd}`)
		);
	}
	return lines;
}

/**
 * Format PRD coverage. Returns an empty string when there is nothing to
 * report (no task records a PRD section).
 *
 * @param coverage - From `checkPrdCoverage`
 * @param width - Terminal width; rows are cut to fit on one line
 */
export function formatPrdCoverage(
	coverage: PrdCoverage | null | undefined,
	width = terminalWidth()
): string {
	if (!coverage) return '';
	const lines = coverage.files.flatMap((file) => fileLines(file, width));
	if (coverage.unsourced.length > 0) {
		lines.push(
			warn(
				`${plural(coverage.unsourced.length, 'task')} ${coverage.unsourced.length === 1 ? 'has' : 'have'} no PRD section`
			),
			...rows(
				coverage.unsourced.map((task) => ({
					key: terminalSafe(task.id),
					text: terminalSafe(task.title)
				})),
				width
			)
		);
	}
	return lines.join('\n');
}
