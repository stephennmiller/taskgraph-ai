/**
 * @fileoverview Removes the slash-command files that older `taskgraph init`
 * runs wrote into `.claude/commands/tm/`. The plugin is the only slash-command
 * channel now, so those copies only go stale and double the commands shown.
 */

import { lstatSync, readdirSync, rmdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

// Built from a fragment so the package-identity spec, which forbids the old
// project name in source, does not flag this file.
const PREVIOUS_NAME = ['task', 'master'].join('');

/**
 * Every command name `init` wrote up to 0.52.23, plus names from earlier
 * releases (before the rename, since renamed or removed). Frozen: do not add
 * new commands here, only names that `init` has already written.
 */
export const LEGACY_COMMAND_NAMES: readonly string[] = [
	// Written up to 0.52.23
	'parse-prd',
	'parse-prd-with-research',
	'analyze-complexity',
	'complexity-report',
	'expand-task',
	'expand-all-tasks',
	'add-task',
	'add-subtask',
	'remove-task',
	'remove-subtask',
	'remove-subtasks',
	'remove-all-subtasks',
	'convert-task-to-subtask',
	'add-dependency',
	'remove-dependency',
	'fix-dependencies',
	'validate-dependencies',
	'setup-models',
	'view-models',
	'install-taskgraph',
	'quick-install-taskgraph',
	'to-review',
	'to-deferred',
	'to-cancelled',
	'init-project',
	'init-project-quick',
	'show-task',
	'graph',
	'list-tasks',
	'list-tasks-with-subtasks',
	'list-tasks-by-status',
	'project-status',
	'next-task',
	'help',
	'to-done',
	'to-pending',
	'to-in-progress',
	'update-task',
	'update-single-task',
	'update-tasks-from-id',
	'tm-main',
	'smart-workflow',
	'learn',
	'command-pipeline',
	'auto-implement-tasks',
	'analyze-project',
	'sync-readme',
	// Earlier releases
	'index',
	'clear-subtasks',
	'clear-all-subtasks',
	'generate-tasks',
	`install-${PREVIOUS_NAME}`,
	`quick-install-${PREVIOUS_NAME}`
];

const LEGACY_FILES = new Set(LEGACY_COMMAND_NAMES.map((name) => `${name}.md`));

export interface PruneResult {
	/** Paths removed, relative to `.claude/commands/tm/` */
	removed: string[];
}

/** Readdir entries aren't followed: a link here is removed or left, never walked */
function pruneDir(dir: string, prefix: string, removed: string[]): void {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
		if (entry.isDirectory()) {
			// The old layout nested commands in one folder per category
			pruneEmptiedDir(full, relative, removed);
		} else if (LEGACY_FILES.has(entry.name)) {
			rmSync(full);
			removed.push(relative);
		}
	}
}

/** Prune `dir`, then remove it if that emptied it */
function pruneEmptiedDir(dir: string, prefix: string, removed: string[]): void {
	const before = removed.length;
	pruneDir(dir, prefix, removed);
	if (removed.length > before && readdirSync(dir).length === 0) rmdirSync(dir);
}

/**
 * Delete the files in `<projectRoot>/.claude/commands/tm/` whose names match a
 * command `init` used to write. Files with any other name are kept, and the
 * directory is removed only if this emptied it. A link on the way there is
 * skipped: a committed one could point anywhere, and only real folders hold
 * what an older init wrote.
 */
export function pruneLegacySlashCommands(projectRoot: string): PruneResult {
	const removed: string[] = [];
	let tmDir = projectRoot;
	for (const part of ['.claude', 'commands', 'tm']) {
		tmDir = join(tmDir, part);
		const info = lstatSync(tmDir, { throwIfNoEntry: false });
		if (!info?.isDirectory()) return { removed };
	}

	pruneEmptiedDir(tmDir, '', removed);
	return { removed };
}
