/**
 * @fileoverview What the tasks.json merge driver did, printed inside
 * `git merge` / `git pull` output, e.g.
 *
 *   ✓ Merged tasks.json; renumbered incoming 3 → 5, 1.2 → 1.4 · feature: 2 → 3
 *
 * or, when both branches changed the same field:
 *
 *   ✗ 2 changes to tasks.json clash; kept this branch's values
 *     1    status  done · incoming: in-progress
 *     1.1  title   Ours sub · incoming: Theirs sub
 *   Edit .taskgraph/tasks/tasks.json to choose, then git add it
 *
 * and how `init --merge-driver` set it up:
 *
 *   ✓ Git now merges tasks.json by task
 *     .gitattributes  routes tasks.json to the driver; commit it
 *     .git/config     turns it on here; each clone runs init --merge-driver
 */

import { sanitizeForTerminal } from '@tm/core';
import chalk from 'chalk';
import { terminalWidth } from '../layout/helpers.js';
import { theme } from '../theme.js';

export interface MergeRenumberedRow {
	tag: string;
	from: string;
	to: string;
}

export interface MergeConflictRow {
	tag: string;
	id?: string;
	field: string;
	kind: 'changed-both' | 'removed-ours' | 'removed-theirs';
	ours: unknown;
	theirs: unknown;
}

/** The tag every project has; its name is left out of the output */
const DEFAULT_TAG = 'master';

const fit = (text: string, width: number) =>
	text.length > width ? `${text.slice(0, Math.max(1, width - 1))}…` : text;

/** `3 → 5, 1.2 → 1.4 · feature: 2 → 3`, cut to `width` with `+N more` */
function describeRenumbered(rows: MergeRenumberedRow[], width: number): string {
	const byTag = new Map<string, string[]>();
	for (const row of rows) {
		byTag.set(row.tag, [
			...(byTag.get(row.tag) ?? []),
			`${row.from} → ${row.to}`
		]);
	}
	const groups = [...byTag].map(([tag, moves]) =>
		tag === DEFAULT_TAG
			? moves
			: moves.map((m, i) => (i === 0 ? `${tag}: ${m}` : m))
	);

	// Build the line one move at a time so a cut never splits a move
	let text = '';
	let shown = 0;
	for (const [g, moves] of groups.entries()) {
		for (const [i, move] of moves.entries()) {
			const sep = shown === 0 ? '' : i === 0 && g > 0 ? ' · ' : ', ';
			const rest = rows.length - shown - 1;
			const more = rest > 0 ? `, +${rest} more` : '';
			if (shown > 0 && (text + sep + move + more).length > width) {
				return `${text}, +${rows.length - shown} more`;
			}
			text += sep + move;
			shown++;
		}
	}
	return text;
}

/**
 * The one line for a merge that renumbered incoming tasks. Empty when nothing
 * was renumbered: a clean merge is a non-event and prints nothing.
 *
 * @param clean - false when the merge also conflicted; the line is then a
 *   muted note under the conflict report rather than a ✓ result
 */
export function formatMergeRenumbered(
	rows: MergeRenumberedRow[],
	clean = true,
	width = terminalWidth()
): string {
	rows = sanitizeForTerminal(rows);
	if (rows.length === 0) return '';
	if (!clean) {
		const lead = 'Renumbered incoming ';
		return theme.muted(lead + describeRenumbered(rows, width - lead.length));
	}
	const lead = '✓ Merged tasks.json; renumbered incoming ';
	return `${chalk.green('✓')}${lead.slice(1)}${describeRenumbered(rows, width - lead.length)}`;
}

const show = (value: unknown): string => {
	if (value === undefined) return 'none';
	if (typeof value === 'string') return value.replace(/\s+/g, ' ');
	return JSON.stringify(value);
};

/**
 * The clash report, for stderr.
 *
 * @param tasksFile - The path git passed (`%P`)
 * @param renumbered - Incoming items that were also renumbered, as a note
 */
export function formatMergeConflicts(
	conflicts: MergeConflictRow[],
	tasksFile: string,
	renumbered: MergeRenumberedRow[] = [],
	width = terminalWidth()
): string {
	conflicts = sanitizeForTerminal(conflicts);
	renumbered = sanitizeForTerminal(renumbered);
	const count = conflicts.length;
	const head =
		count === 1
			? `${chalk.red('✗')} 1 change to tasks.json clashes; kept this branch's value`
			: `${chalk.red('✗')} ${count} changes to tasks.json clash; kept this branch's values`;

	const label = (row: MergeConflictRow) => {
		if (row.id === undefined) return `tag ${row.tag}`;
		return row.tag === DEFAULT_TAG ? row.id : `${row.tag} ${row.id}`;
	};
	const idWidth = Math.max(...conflicts.map((row) => label(row).length));
	const fieldWidth = Math.max(
		0,
		...conflicts
			.filter((row) => row.kind === 'changed-both')
			.map((row) => row.field.length)
	);

	const rows = conflicts.map((row) => {
		const indent = `  ${label(row).padEnd(idWidth)}  `;
		if (row.kind === 'removed-ours') {
			return `${indent}removed here, changed on the incoming branch; kept it`;
		}
		if (row.kind === 'removed-theirs') {
			return `${indent}removed on the incoming branch, changed here; kept it`;
		}
		// Cut the plain text, then color it, so ANSI codes never count
		const plain = `${row.field.padEnd(fieldWidth)}  ${show(row.ours)} · incoming: ${show(row.theirs)}`;
		const cut = fit(plain, width - indent.length);
		const mark = cut.lastIndexOf(' · incoming: ');
		const text =
			mark === -1 ? cut : cut.slice(0, mark) + theme.muted(cut.slice(mark));
		return `${indent}${text}`;
	});

	const note = formatMergeRenumbered(renumbered, false, width);
	return [
		head,
		...rows,
		...(note ? [note] : []),
		theme.muted(`Edit ${tasksFile} to choose, then git add it`)
	].join('\n');
}

export type MergeDriverSetup = {
	attributes: 'created' | 'updated' | 'unchanged' | 'kept';
	config: 'set' | 'unchanged' | 'kept';
};

/**
 * What `init --merge-driver` changed, or one line when nothing did. A merge
 * setup the user made themselves is left alone and named, with how to
 * switch to TaskGraph's.
 */
export function formatMergeDriverSetup(setup: MergeDriverSetup): string {
	if (setup.attributes === 'unchanged' && setup.config === 'unchanged') {
		return 'The tasks.json merge driver is already set up';
	}
	const kept = setup.attributes === 'kept' || setup.config === 'kept';
	const lines = [
		kept
			? `${chalk.yellow('!')} Kept your own tasks.json merge setup`
			: `${chalk.green('✓')} Git now merges tasks.json by task`
	];
	if (setup.attributes === 'kept') {
		lines.push(
			`  .gitattributes  ${theme.muted("has its own tasks.json merge line; delete it for TaskGraph's")}`
		);
	} else if (setup.attributes !== 'unchanged') {
		lines.push(
			`  .gitattributes  ${theme.muted('routes tasks.json to the driver; commit it')}`
		);
	}
	if (setup.config === 'kept') {
		lines.push(
			`  .git/config     ${theme.muted("merge.taskgraph.driver is yours; unset it for TaskGraph's")}`
		);
	} else if (setup.config === 'set') {
		lines.push(
			`  .git/config     ${theme.muted('turns it on here; each clone runs init --merge-driver')}`
		);
	}
	return lines.join('\n');
}
