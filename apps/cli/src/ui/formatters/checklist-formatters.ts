/**
 * @fileoverview A task's acceptance criteria and Definition of Done, e.g.
 *
 *   Acceptance criteria  1/2
 *     ✓ 1  Users can log in with email and password
 *     ○ 2  JWT tokens are issued on successful login
 *   Definition of Done  0/1
 *     ○ 3  Tests pass
 *
 * After `set-status 3 --check 1`:
 *
 *   ✓ Task 3  2 of 3 checked
 *     ○ 3  Tests pass
 *
 * And when `set-status 3 done` is refused:
 *
 *   ✗ 2 criteria unchecked on task 3
 *     ○ 2  JWT tokens are issued on successful login
 *     ○ 3  Tests pass
 *     Check them with taskgraph set-status 3 --check 2,3, or pass --force
 *
 * The numbers are the ones `--check` takes, so each line says what to type.
 */

import type { ChecklistItem, TaskChecklist } from '@tm/core';
import chalk from 'chalk';
import { wrapLine } from '../layout/helpers.js';
import { theme } from '../theme.js';

/** Checklist text wraps at the terminal width, but no wider than this */
const MAX_WIDTH = 100;

const columns = (width?: number) =>
	Math.max(40, Math.min(width ?? (process.stdout.columns || 80), MAX_WIDTH));

/**
 * One item per line: a green ✓ or a muted ○, its number, then its text,
 * wrapped under the text rather than under the mark.
 */
function formatItems(
	items: ChecklistItem[],
	numberWidth: number,
	width: number
): string[] {
	return items.flatMap((item) => {
		const mark = item.checked ? chalk.green('✓') : theme.muted('○');
		const number = theme.brand(String(item.number).padStart(numberWidth));
		const lead = `  ${mark} ${number}  `;
		const indent = ' '.repeat(2 + 2 + numberWidth + 2);
		return wrapLine(`${lead}${theme.text(item.text)}`, width, indent);
	});
}

const numberWidthOf = (items: ChecklistItem[]) =>
	Math.max(1, ...items.map((item) => String(item.number).length));

/**
 * The checklist as `show` prints it: the task's own criteria, then the
 * Definition of Done, each under a heading with its count. Empty when the
 * task has neither.
 */
export function formatChecklist(
	checklist: TaskChecklist,
	width?: number
): string {
	const cols = columns(width);
	const numberWidth = numberWidthOf(checklist.items);
	const groups: Array<[string, ChecklistItem[]]> = [
		['Acceptance criteria', checklist.items.filter((i) => i.source === 'task')],
		[
			'Definition of Done',
			checklist.items.filter((i) => i.source === 'definition-of-done')
		]
	];

	return groups
		.filter(([, items]) => items.length > 0)
		.flatMap(([heading, items]) => {
			const checked = items.filter((i) => i.checked).length;
			return [
				`${chalk.bold(heading)}  ${theme.muted(`${checked}/${items.length}`)}`,
				...formatItems(items, numberWidth, cols)
			];
		})
		.join('\n');
}

/**
 * The confirmation after `--check` or `--uncheck`: the count, then what is
 * still unchecked. With nothing left, the next step is marking it done.
 */
export function formatChecklistUpdate(
	taskId: string,
	checklist: TaskChecklist,
	width?: number
): string {
	const total = checklist.items.length;
	const head = `${chalk.green('✓')} Task ${theme.brand(taskId)}`;
	if (checklist.unchecked.length === 0) {
		return [
			`${head}  all ${total} checked`,
			`Next: ${theme.brand(`taskgraph set-status ${taskId} done`)}`
		].join('\n');
	}
	return [
		`${head}  ${checklist.checkedCount} of ${total} checked`,
		...formatItems(
			checklist.unchecked,
			numberWidthOf(checklist.unchecked),
			columns(width)
		)
	].join('\n');
}

/**
 * The refusal when `set-status done` meets unchecked items: what is wrong,
 * the items, then the fix.
 */
export function formatUncheckedCriteria(
	message: string,
	taskId: string,
	unchecked: ChecklistItem[],
	width?: number
): string {
	const cols = columns(width);
	const numbers = unchecked.map((item) => item.number).join(',');
	const hint = `  ${theme.muted('Check them with')} ${theme.brand(`taskgraph set-status ${taskId} --check ${numbers}`)}${theme.muted(', or pass')} ${theme.brand('--force')}`;
	return [
		`${chalk.red('✗')} ${message}`,
		...formatItems(unchecked, numberWidthOf(unchecked), cols),
		...wrapLine(hint, cols, '  ')
	].join('\n');
}
