/**
 * @fileoverview The Git side of the tasks.json merge driver: run a merge on
 * git's three temporary files, and set the driver up in a repository.
 *
 * Git calls the driver as `<command> %O %A %B %P` (ancestor, current, other,
 * path) and takes the content of `%A` afterwards as the result. Exit 0 means
 * merged; non-zero means conflicted, and git leaves the file in the index
 * as unmerged. The driver always leaves `%A` as valid JSON: when a side
 * can't be parsed it doesn't touch `%A` at all (the current branch's file).
 *
 * Setup is two parts: a `.gitattributes` line, committed, that routes
 * tasks.json to the driver named `taskgraph`, and the `merge.taskgraph.*`
 * entries in `.git/config`, which git never shares, so each clone runs the
 * setup once. A clone without the config falls back to git's normal text
 * merge, so the attribute is safe to commit.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { TASKGRAPH_TASKS_FILE } from '../../../common/constants/paths.js';
import { type TasksMergeResult, mergeTasksJson } from './merge-tasks-json.js';

/** The driver's name in `.gitattributes` and `merge.<name>.*` */
export const MERGE_DRIVER_NAME = 'taskgraph';

/** The `.gitattributes` line, relative to the project root */
export const MERGE_DRIVER_ATTRIBUTE = `${TASKGRAPH_TASKS_FILE} merge=${MERGE_DRIVER_NAME}`;

/** Git's placeholders: ancestor, current (also the output), other, path */
const DRIVER_ARGS = 'merge-driver %O %A %B %P';

export interface MergeDriverFiles {
	/** `%O`, the common ancestor; empty when the file is new on both sides */
	basePath: string;
	/** `%A`, the current branch; the merged result is written here */
	oursPath: string;
	/** `%B`, the branch being merged in */
	theirsPath: string;
}

export type MergeDriverOutcome =
	| ({ status: 'merged' | 'conflicted' } & Omit<TasksMergeResult, 'merged'>)
	| {
			status: 'unreadable';
			side: 'base' | 'ours' | 'theirs';
			reason: string;
	  };

/**
 * Merge git's three versions of tasks.json and write the result to `%A`.
 * `conflicted` means the file was written with the current branch's value
 * for each conflicting field; `unreadable` means nothing was written.
 */
export function runTasksMergeDriver(
	files: MergeDriverFiles
): MergeDriverOutcome {
	const sides = [
		['base', files.basePath],
		['ours', files.oursPath],
		['theirs', files.theirsPath]
	] as const;
	const parsed: Record<string, unknown> = {};
	let oursText = '';
	for (const [side, file] of sides) {
		let text: string;
		try {
			text = fs.readFileSync(file, 'utf8');
		} catch (error) {
			return { status: 'unreadable', side, reason: (error as Error).message };
		}
		if (side === 'ours') oursText = text;
		if (text.trim() === '') {
			parsed[side] = undefined;
			continue;
		}
		try {
			parsed[side] = JSON.parse(text);
		} catch (error) {
			return { status: 'unreadable', side, reason: (error as Error).message };
		}
	}

	const { merged, renumbered, conflicts } = mergeTasksJson(
		parsed.base,
		parsed.ours,
		parsed.theirs
	);
	const content =
		JSON.stringify(merged, null, 2) + (oursText.endsWith('\n') ? '\n' : '');
	writeAtomically(files.oursPath, content);

	return {
		status: conflicts.length > 0 ? 'conflicted' : 'merged',
		renumbered,
		conflicts
	};
}

function writeAtomically(file: string, content: string): void {
	const temp = `${file}.taskgraph-merge-${process.pid}`;
	fs.writeFileSync(temp, content, 'utf8');
	fs.renameSync(temp, file);
}

export interface MergeDriverCommandOptions {
	/** Whether `taskgraph` is on PATH, so git can run it by name */
	onPath: boolean;
	/** Node's executable, for running this CLI by its path */
	execPath: string;
	/** The CLI's entry script */
	scriptPath: string;
}

/**
 * The command git runs. `taskgraph` when it's on PATH, so upgrades keep
 * working; otherwise this CLI by its absolute path (npx, local installs).
 */
export function mergeDriverCommand(options: MergeDriverCommandOptions): string {
	if (options.onPath) return `taskgraph ${DRIVER_ARGS}`;
	const quote = (value: string) => `"${value.replace(/(["\\$`])/g, '\\$1')}"`;
	return `${quote(options.execPath)} ${quote(options.scriptPath)} ${DRIVER_ARGS}`;
}

/** Whether an executable with this name is in a PATH directory */
export function isOnPath(
	name: string,
	envPath = process.env.PATH ?? '',
	extensions = process.platform === 'win32'
		? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';')
		: ['']
): boolean {
	for (const dir of envPath.split(path.delimiter)) {
		if (!dir) continue;
		for (const ext of extensions) {
			try {
				const file = path.join(dir, name + ext.toLowerCase());
				const stat = fs.statSync(file);
				if (!stat.isFile()) continue;
				if (process.platform !== 'win32')
					fs.accessSync(file, fs.constants.X_OK);
				return true;
			} catch {
				// not here
			}
		}
	}
	return false;
}

export interface MergeDriverInstallResult {
	/** What happened to `.gitattributes` in the project root */
	attributes: 'created' | 'updated' | 'unchanged';
	/** Whether `.git/config` already had this exact driver command */
	config: 'set' | 'unchanged';
}

export class NotAGitRepositoryError extends Error {
	constructor(projectRoot: string) {
		super(`${projectRoot} isn't in a Git repository`);
		this.name = 'NotAGitRepositoryError';
	}
}

const git = (projectRoot: string, args: string[]) =>
	execFileSync('git', args, {
		cwd: projectRoot,
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'ignore']
	}).trim();

/** Whether `projectRoot` is inside a Git work tree */
export function isInsideGitWorkTree(projectRoot: string): boolean {
	try {
		return git(projectRoot, ['rev-parse', '--is-inside-work-tree']) === 'true';
	} catch {
		return false;
	}
}

/**
 * Set up the merge driver: add the `.gitattributes` line (keeping what's
 * there) and point `merge.taskgraph.driver` at `command`. Safe to repeat.
 *
 * @throws NotAGitRepositoryError when `projectRoot` isn't in a Git work tree
 */
export function installMergeDriver(
	projectRoot: string,
	command: string
): MergeDriverInstallResult {
	if (!isInsideGitWorkTree(projectRoot)) {
		throw new NotAGitRepositoryError(projectRoot);
	}

	const attributesFile = path.join(projectRoot, '.gitattributes');
	let attributes: MergeDriverInstallResult['attributes'] = 'unchanged';
	const existing = fs.existsSync(attributesFile)
		? fs.readFileSync(attributesFile, 'utf8')
		: null;
	const lines = (existing ?? '').split(/\r?\n/).map((line) => line.trim());
	if (!lines.includes(MERGE_DRIVER_ATTRIBUTE)) {
		const separator = existing && !existing.endsWith('\n') ? '\n' : '';
		fs.writeFileSync(
			attributesFile,
			`${existing ?? ''}${separator}${MERGE_DRIVER_ATTRIBUTE}\n`,
			'utf8'
		);
		attributes = existing === null ? 'created' : 'updated';
	}

	const key = `merge.${MERGE_DRIVER_NAME}`;
	let current = '';
	try {
		current = git(projectRoot, ['config', '--local', '--get', `${key}.driver`]);
	} catch {
		// not set
	}
	let config: MergeDriverInstallResult['config'] = 'unchanged';
	if (current !== command) {
		git(projectRoot, [
			'config',
			'--local',
			`${key}.name`,
			'TaskGraph tasks.json merge'
		]);
		git(projectRoot, ['config', '--local', `${key}.driver`, command]);
		config = 'set';
	}

	return { attributes, config };
}
