/**
 * @fileoverview The Git side of the merge driver for tasks.json and
 * archive.json: run a merge on git's three temporary files, and set the
 * driver up in a repository.
 *
 * Git calls the driver as `<command> %O %A %B %P` (ancestor, current, other,
 * path) and takes the content of `%A` afterwards as the result. Exit 0 means
 * merged; non-zero means conflicted, and git leaves the file in the index
 * as unmerged. The driver always leaves `%A` as valid JSON: when a side
 * can't be parsed it doesn't touch `%A` at all (the current branch's file).
 *
 * Setup is two parts: `.gitattributes` lines, committed, that route
 * tasks.json and archive.json to the driver named `taskgraph`, and the
 * `merge.taskgraph.*` entries in `.git/config`, which git never shares, so
 * each clone runs the setup once. A clone without the config falls back to git's normal text
 * merge, so the attribute is safe to commit.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { TASKGRAPH_TASKS_FILE } from '../../../common/constants/paths.js';
import {
	ARCHIVE_FILE_NAME,
	archivePathFor,
	readArchiveSync
} from '../../tasks/utils/archive.js';
import { mergeArchiveJson } from './merge-archive-json.js';
import { type TasksMergeResult, mergeTasksJson } from './merge-tasks-json.js';

/** The driver's name in `.gitattributes` and `merge.<name>.*` */
export const MERGE_DRIVER_NAME = 'taskgraph';

/** The files the driver merges, relative to the project root */
const MERGED_FILES = [
	TASKGRAPH_TASKS_FILE,
	path.posix.join(path.posix.dirname(TASKGRAPH_TASKS_FILE), ARCHIVE_FILE_NAME)
];

/** The `.gitattributes` lines, relative to the project root */
export const MERGE_DRIVER_ATTRIBUTES = MERGED_FILES.map(
	(file) => `${file} merge=${MERGE_DRIVER_NAME}`
);

/** Git's placeholders: ancestor, current (also the output), other, path */
const DRIVER_ARGS = 'merge-driver %O %A %B %P';

export interface MergeDriverFiles {
	/** `%O`, the common ancestor; empty when the file is new on both sides */
	basePath: string;
	/** `%A`, the current branch; the merged result is written here */
	oursPath: string;
	/** `%B`, the branch being merged in */
	theirsPath: string;
	/**
	 * `%P`, the file being merged, resolved. archive.json merges as the
	 * archive; anything else as tasks.json. The other file of the pair is
	 * read from beside it in the working tree, which during a merge still
	 * holds this branch's version (git writes results after all drivers run).
	 * There, new incoming tasks never take an ID archive.json holds, and the
	 * archive reports an incoming archived ID tasks.json reuses. A file
	 * that is missing or can't be read is skipped.
	 */
	path?: string;
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
		// An array, string or null at the top isn't a tasks file; merging it
		// as one would drop that side's content without a conflict
		const value = parsed[side];
		if (value === null || typeof value !== 'object' || Array.isArray(value)) {
			return {
				status: 'unreadable',
				side,
				reason: 'not a JSON object'
			};
		}
	}

	const file = files.path;
	const { merged, renumbered, conflicts } =
		file && path.basename(file) === ARCHIVE_FILE_NAME
			? mergeArchiveJson(parsed.base, parsed.ours, parsed.theirs, {
					tasks: readJsonOrNone(
						path.join(path.dirname(file), path.basename(TASKGRAPH_TASKS_FILE))
					)
				})
			: mergeTasksJson(parsed.base, parsed.ours, parsed.theirs, {
					archive: file ? readJsonOrNone(archivePathFor(file)) : {}
				});
	const content =
		JSON.stringify(merged, null, 2) + (oursText.endsWith('\n') ? '\n' : '');
	writeAtomically(files.oursPath, content);

	return {
		status: conflicts.length > 0 ? 'conflicted' : 'merged',
		renumbered,
		conflicts
	};
}

/** The parsed file, or none when it is missing or unreadable */
function readJsonOrNone(file: string): unknown {
	try {
		return readArchiveSync(file);
	} catch {
		return {};
	}
}

/**
 * Write next to `file`, then rename over it, so `%A` is either the old
 * content or the whole merge. `wx` refuses a temp name that already exists
 * (including a symlink planted there) instead of writing through it.
 */
function writeAtomically(file: string, content: string): void {
	const temp = `${file}.taskgraph-merge-${process.pid}`;
	try {
		fs.writeFileSync(temp, content, { encoding: 'utf8', flag: 'wx' });
		fs.renameSync(temp, file);
	} catch (error) {
		fs.rmSync(temp, { force: true });
		throw error;
	}
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
 * What git runs when the TaskGraph CLI is gone (uninstalled, a clone on a
 * machine without it, a moved npx cache): git's own line-based merge of the
 * same three files. It writes conflict markers into `%A` and exits non-zero
 * on a clash, exactly like a repository with no merge driver at all.
 */
export const MERGE_DRIVER_FALLBACK =
	'git merge-file -L ours -L base -L theirs %A %O %B';

/**
 * The command git runs (through `sh`, also on Windows). `taskgraph` when
 * it's on PATH, so upgrades keep working; otherwise this CLI by its absolute
 * path (npx, local installs). Either way it first checks that the CLI is
 * still there and, if not, falls back to {@link MERGE_DRIVER_FALLBACK}, so a
 * missing install gives a normal conflict instead of a failed merge that
 * silently keeps this branch's file.
 */
export function mergeDriverCommand(options: MergeDriverCommandOptions): string {
	const fallback = `else ${MERGE_DRIVER_FALLBACK}; fi`;
	if (options.onPath) {
		return `if command -v taskgraph >/dev/null 2>&1; then taskgraph ${DRIVER_ARGS}; ${fallback}`;
	}
	// Double quotes for sh, then `%` doubled: git expands `%A` and friends
	// anywhere in the command, and reads `%%` as one `%`
	const quote = (value: string) =>
		`"${value.replace(/(["\\$`])/g, '\\$1')}"`.replace(/%/g, '%%');
	const node = quote(options.execPath);
	const script = quote(options.scriptPath);
	return `if [ -x ${node} ] && [ -f ${script} ]; then ${node} ${script} ${DRIVER_ARGS}; ${fallback}`;
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
	/**
	 * What happened to `.gitattributes` in the project root. `kept`: a line
	 * already gives tasks.json or archive.json another merge attribute, left
	 * as it is (a missing line for the other file is still added)
	 */
	attributes: 'created' | 'updated' | 'unchanged' | 'kept';
	/**
	 * Whether `.git/config` already had this exact driver command. `kept`:
	 * `merge.taskgraph.driver` is a command TaskGraph didn't write, left as it is
	 */
	config: 'set' | 'unchanged' | 'kept';
}

/** Whether a configured driver command is one {@link mergeDriverCommand} wrote */
const isOurCommand = (command: string) =>
	command.includes(` ${DRIVER_ARGS}`) &&
	command.includes(MERGE_DRIVER_FALLBACK);

/**
 * The merge attribute an existing `.gitattributes` line gives `file`
 * (`merge=x`, `merge`, `-merge`, `!merge`), or undefined. Only lines naming
 * the file itself count; a wider pattern is the user's business, and ours,
 * added after it, takes precedence for this one file.
 */
function existingMergeAttribute(
	lines: string[],
	file: string
): string | undefined {
	let found: string | undefined;
	for (const line of lines) {
		const [pattern, ...attributes] = line.split(/\s+/);
		if (pattern.replace(/^\//, '') !== file) continue;
		for (const attribute of attributes) {
			if (/^[-!]?merge(=|$)/.test(attribute)) found = attribute;
		}
	}
	return found;
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
 * Set up the merge driver: add the `.gitattributes` lines (keeping what's
 * there) and point `merge.taskgraph.driver` at `command`. Safe to repeat,
 * and a project set up before archive.json had a driver gets its line.
 * A merge attribute for either file or a `merge.taskgraph.driver` that
 * TaskGraph didn't write is the user's own setup and is left alone (`kept`).
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
	const missing: string[] = [];
	for (const [i, file] of MERGED_FILES.entries()) {
		const current = existingMergeAttribute(lines, file);
		if (current === undefined) missing.push(MERGE_DRIVER_ATTRIBUTES[i]);
		else if (current !== `merge=${MERGE_DRIVER_NAME}`) attributes = 'kept';
	}
	if (missing.length > 0) {
		const separator = existing && !existing.endsWith('\n') ? '\n' : '';
		fs.writeFileSync(
			attributesFile,
			`${existing ?? ''}${separator}${missing.join('\n')}\n`,
			'utf8'
		);
		if (attributes !== 'kept') {
			attributes = existing === null ? 'created' : 'updated';
		}
	}

	const key = `merge.${MERGE_DRIVER_NAME}`;
	const read = (name: string) => {
		try {
			return git(projectRoot, ['config', '--local', '--get', `${key}.${name}`]);
		} catch {
			return ''; // not set
		}
	};
	const driver = read('driver');
	let config: MergeDriverInstallResult['config'] = 'unchanged';
	if (driver !== command && driver !== '' && !isOurCommand(driver)) {
		// Someone set up their own driver under this name; don't replace it
		config = 'kept';
	} else if (driver !== command) {
		// The command first: a `merge.taskgraph` section with a name but no
		// driver makes git stop with "lacks command line" instead of falling
		// back to a text merge
		git(projectRoot, ['config', '--local', `${key}.driver`, command]);
		if (read('name') === '') {
			git(projectRoot, [
				'config',
				'--local',
				`${key}.name`,
				'TaskGraph tasks.json and archive.json merge'
			]);
		}
		config = 'set';
	}

	return { attributes, config };
}
