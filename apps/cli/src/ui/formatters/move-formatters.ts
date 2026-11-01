/**
 * @fileoverview What `move` did, or why a move to another tag was refused:
 *
 *   ✓ Moved task 5 to new ID 7
 *   ✓ Converted subtask 4.1 to task 6
 *   Skipped 8 → 8 (same ID)
 *
 *   ✓ Moved 2 tasks from "backlog" to "sprint"
 *   Next: taskgraph fix-dependencies --check, then fix-dependencies
 *
 *   ✗ Can't move tasks from "backlog" to "sprint": 1 dependency conflict
 *     Task 5 depends on 4 (in backlog)
 *     Move them too: taskgraph move ... --with-dependencies, or drop them with
 *     --ignore-dependencies (or restore them first, when archived)
 */

import { type CrossTagConflict, crossTagConflictFixes } from '@tm/core';
import chalk from 'chalk';
import { theme } from '../theme.js';
import { terminalSafe } from './markdown-formatters.js';

/** A move within a tag: one line per move, then the pairs skipped */
export function formatMoves(
	moves: Array<{ message: string }>,
	skipped: Array<{ fromId: string; toId: string }> = []
): string {
	return [
		...moves.map((move) => `${chalk.green('✓')} ${move.message}`),
		...skipped.map(({ fromId, toId }) =>
			theme.muted(
				`Skipped ${terminalSafe(fromId)} → ${terminalSafe(toId)} (same ID)`
			)
		)
	].join('\n');
}

/** A move to another tag */
export function formatTagMove(
	count: number,
	fromTag: string,
	toTag: string,
	droppedDependencies: boolean
): string {
	const lines = [
		`${chalk.green('✓')} Moved ${count} ${count === 1 ? 'task' : 'tasks'} from "${terminalSafe(fromTag)}" to "${terminalSafe(toTag)}"`
	];
	if (droppedDependencies) {
		lines.push(
			theme.muted('Next: ') +
				theme.brand('taskgraph fix-dependencies --check') +
				theme.muted(', then ') +
				theme.brand('taskgraph fix-dependencies')
		);
	}
	return lines.join('\n');
}

/**
 * The dependencies that kept tasks from moving to another tag, one per
 * line, for the body of the error (which strips escape codes)
 */
export function formatCrossTagConflicts(conflicts: CrossTagConflict[]): string {
	return conflicts.map((conflict) => `  ${conflict.message}`).join('\n');
}

/**
 * What to do about the dependencies that kept tasks from moving: move them
 * too, or drop them. An archived one can't move, so it must be restored first.
 * @param moveTo - The move's flags, escaped, for the commands to copy
 */
export function formatCrossTagConflictHint(
	conflicts: CrossTagConflict[],
	moveTo: string,
	sourceTag: string
): string {
	const restoreStep = `\`taskgraph archive restore <id> --tag=${terminalSafe(sourceTag)}\``;
	const fixStep = `\`taskgraph fix-dependencies --tag=${terminalSafe(sourceTag)}\``;
	const { moveAlong, restore, missing } = crossTagConflictFixes(conflicts);
	let hint: string;
	if (moveAlong) {
		hint = `Move them too: \`taskgraph move ${moveTo} --with-dependencies\` (tasks that depend on them go in --from), or drop them with --ignore-dependencies`;
		if (restore)
			hint += `. Archived ones can't move until restored: ${restoreStep}`;
	} else if (restore) {
		hint = `Archived tasks can't move: drop them with \`taskgraph move ${moveTo} --ignore-dependencies\`, or restore them first with ${restoreStep}`;
	} else {
		hint = `Drop them with \`taskgraph move ${moveTo} --ignore-dependencies\`, or remove them first with ${fixStep}`;
	}
	return missing && (moveAlong || restore)
		? `${hint}. Missing ones can't move; remove them with ${fixStep}`
		: hint;
}
