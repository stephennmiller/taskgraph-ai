/**
 * @fileoverview What `parse-prd --append` found changed in the PRD since its
 * tasks were made, one line per group, printed before the AI call:
 *
 *   2 new sections in docs/prd.md · #two-factor-sign-in, #exports
 *   ⚠ 1 changed section · #search--tags · may be stale: tasks 4, 9
 *   ⚠ 1 removed section · #rate-limiting · task 7 cites it
 *
 * With no new sections nothing goes to the AI, and the first line says so:
 *
 *   ✓ docs/prd.md is unchanged since its tasks were made · no tasks added
 */

import type { PrdDelta } from '@tm/core';
import chalk from 'chalk';
import { terminalWidth } from '../layout/helpers.js';
import { theme } from '../theme.js';
import { terminalSafe } from './markdown-formatters.js';

type Id = number | string;

const plural = (count: number, noun: string) =>
	`${count} ${count === 1 ? noun : `${noun}s`}`;

/** `4, 9, 12`; past six IDs, `1, 2, 3, 4, 5 +3 more` */
function listIds(ids: Id[]): string {
	if (ids.length > 6) {
		return `${ids.slice(0, 5).join(', ')} +${ids.length - 5} more`;
	}
	return ids.join(', ');
}

/** Unique task IDs in number order */
const sortedIds = (ids: Id[]) =>
	[...new Set(ids)].sort((a, b) => Number(a) - Number(b) || 0);

/**
 * `#a, #b, #c`, or `#a, #b +3 more` when the whole list would pass `width`
 */
function slugList(slugs: string[], width: number): string {
	const items = slugs.map((slug) => `#${terminalSafe(slug)}`);
	const all = items.join(', ');
	if (all.length <= width) return all;
	for (let shown = items.length - 1; shown >= 1; shown--) {
		const text = `${items.slice(0, shown).join(', ')} +${items.length - shown} more`;
		if (text.length <= width) return text;
	}
	return plural(items.length, 'section');
}

/**
 * One line: `<lead> · <slugs> · <tail>`, the slug list cut so the line fits
 */
function groupLine(
	lead: string,
	slugs: string[],
	tail: string,
	width: number,
	mark = ''
): string {
	const fixed = mark.length + lead.length + 3 + (tail ? tail.length + 3 : 0);
	const list = slugList(slugs, Math.max(10, width - fixed));
	return (
		(mark ? `${chalk.yellow(mark.trim())} ` : '') +
		lead +
		theme.muted(` · ${list}`) +
		(tail ? theme.muted(` · ${tail}`) : '')
	);
}

/**
 * Format what changed in a PRD since its tasks were made.
 *
 * @param delta - From `diffPrdSections`
 * @param width - Terminal width; slug lists are cut to fit one line
 */
export function formatPrdDelta(
	delta: PrdDelta,
	width = terminalWidth()
): string {
	const prd = terminalSafe(delta.path);
	const lines: string[] = [];
	const changes = delta.changed.length + delta.removed.length;

	if (delta.added.length > 0) {
		lines.push(
			groupLine(
				`${plural(delta.added.length, 'new section')} in ${prd}`,
				delta.added.map((s) => s.slug),
				'',
				width
			)
		);
	} else if (changes === 0) {
		lines.push(
			`${chalk.green('✓')} ${prd} is unchanged since its tasks were made` +
				theme.muted(' · no tasks added')
		);
	} else {
		lines.push(
			`${chalk.green('✓')} No new sections in ${prd}` +
				theme.muted(' · no tasks added')
		);
	}

	if (delta.changed.length > 0) {
		const ids = sortedIds(delta.changed.flatMap((c) => c.taskIds));
		lines.push(
			groupLine(
				plural(delta.changed.length, 'changed section'),
				delta.changed.map((c) => c.slug),
				ids.length > 0
					? `may be stale: ${ids.length === 1 ? 'task' : 'tasks'} ${listIds(ids)}`
					: '',
				width,
				'⚠ '
			)
		);
	}

	if (delta.removed.length > 0) {
		const ids = sortedIds(delta.removed.flatMap((r) => r.taskIds));
		lines.push(
			groupLine(
				plural(delta.removed.length, 'removed section'),
				delta.removed.map((r) => r.slug),
				ids.length > 0
					? `${ids.length === 1 ? 'task' : 'tasks'} ${listIds(ids)} ${ids.length === 1 ? 'cites' : 'cite'} ${delta.removed.length === 1 ? 'it' : 'them'}`
					: '',
				width,
				'⚠ '
			)
		);
	}

	return lines.join('\n');
}
