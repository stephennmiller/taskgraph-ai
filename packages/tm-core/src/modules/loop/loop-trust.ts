/**
 * @fileoverview Per-user record of projects where `loop` may run Claude with
 * permission prompts off. It lives in the home directory, never in the
 * project, so a cloned repo cannot approve itself. Each approval holds a hash
 * of the tasks and project instructions it was given for, so a change to
 * either since (another branch, a pull, a hand edit) needs a new one.
 */

import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import lockfile from 'proper-lockfile';
import { TASK_STATUSES } from '../../common/constants/index.js';
import {
	COMPLEXITY_REPORT_FILE,
	TASKGRAPH_CONFIG_FILE,
	TASKGRAPH_LOCAL_CONFIG_FILE,
	TASKGRAPH_TASKS_FILE
} from '../../common/constants/paths.js';
import { isWithin } from '../../common/utils/project-root-finder.js';
import { mergeMachineConfig } from '../config/services/machine-config.js';
import { readPrdSection } from '../prd/prd-coverage.js';
import { PRD_SOURCE_KEY } from '../prd/prd-sections.js';
import { normalizeDefinitionOfDone } from '../tasks/utils/acceptance-criteria.js';

interface TrustEntry {
	path: string;
	tasks: string;
}

const trustFile = (home: string) =>
	path.join(home, '.taskgraph', 'loop-trusted.json');

/** Entries for other projects, and older bare-path entries, are kept as they are */
function readTrusted(home: string): unknown[] {
	try {
		const list = JSON.parse(fs.readFileSync(trustFile(home), 'utf8'));
		return Array.isArray(list) ? list : [];
	} catch {
		return [];
	}
}

/** The entry for this project, or a bare path from before entries held a hash */
function entryMatches(entry: unknown, root: string): boolean {
	return (
		entry === root ||
		(typeof entry === 'object' &&
			entry !== null &&
			(entry as TrustEntry).path === root)
	);
}

const findEntry = (home: string, root: string) =>
	readTrusted(home).find((e) => entryMatches(e, root));

/** Symlinks and `..` must not make one path look like another */
function canonical(projectRoot: string): string {
	try {
		return fs.realpathSync(projectRoot);
	} catch {
		return path.resolve(projectRoot);
	}
}

/**
 * Progress marks taskgraph rewrites as work moves on, each with the values it
 * takes; any other value (text in a subtask's status, say) is hashed
 * @param doneItems - The project's Definition of Done, the only text a task's
 *   checked items can hold
 */
const progressMarks = (doneItems: Set<string>) =>
	new Map<string, (value: unknown) => boolean>([
		['status', (v) => v === 'completed' || TASK_STATUSES.includes(v as never)],
		['updatedAt', (v) => typeof v === 'string' && /^[\d:.TZ+-]*$/.test(v)],
		['checked', (v) => typeof v === 'boolean'],
		[
			'definitionOfDoneChecked',
			(v) =>
				Array.isArray(v) &&
				v.every((item) => typeof item === 'string' && doneItems.has(item))
		]
	]);

/**
 * config.json with config.local.json merged over it, as the config loader
 * does, but only when git tracks the local file: untracked, it is the
 * user's own, like `LOCAL_FILES`. A file that isn't JSON counts as missing.
 * @param tracked - From `trackedFiles`
 */
function projectConfig(
	root: string,
	tracked: (file: string) => boolean
): Record<string, any> {
	const read = (file: string) => {
		try {
			return JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
		} catch {
			return null;
		}
	};
	return mergeMachineConfig<Record<string, any>>(
		read(TASKGRAPH_CONFIG_FILE),
		tracked(TASKGRAPH_LOCAL_CONFIG_FILE)
			? read(TASKGRAPH_LOCAL_CONFIG_FILE)
			: null
	);
}

/** The project's Definition of Done, from `projectConfig` */
const definitionOfDone = (config: Record<string, any>): Set<string> =>
	new Set(normalizeDefinitionOfDone(config?.global?.definitionOfDone));

/**
 * `loop.bands` and `loop.resumeMaxContextTokens`, which pick each iteration's
 * model, effort and resume; undefined when neither is set
 */
function loopModelSettings(config: Record<string, any>): unknown {
	const loop = config?.loop;
	const settings = [loop?.bands, loop?.resumeMaxContextTokens];
	return settings.some((v) => v !== undefined) ? settings : undefined;
}

/**
 * Project files outside `.claude` the loop's Claude session loads:
 * instructions and the MCP servers it starts
 */
const CLAUDE_FILES = ['CLAUDE.md', '.taskgraph/CLAUDE.md', '.mcp.json'];

/**
 * Files Claude Code loads that are normally each user's own and untracked;
 * they count only when the repository commits them
 */
const LOCAL_FILES = ['CLAUDE.local.md', '.claude/settings.local.json'];

/** Every tag's complexity report, under each name versions have used */
const REPORTS_DIR = path.dirname(COMPLEXITY_REPORT_FILE);

/**
 * The project and each folder above it up to the repository's top level
 * (the nearest with a `.git`, where git looks), as paths from the project:
 * '', '..', '../..'. Undefined outside a repository.
 */
function foldersToTop(root: string): string[] | undefined {
	const folders: string[] = [];
	for (let dir = root, rel = ''; ; rel = rel ? `${rel}/..` : '..') {
		folders.push(rel);
		if (fs.lstatSync(path.join(dir, '.git'), { throwIfNoEntry: false }))
			return folders;
		const parent = path.dirname(dir);
		if (parent === dir) return undefined;
		dir = parent;
	}
}

/**
 * Whether git tracks a file (a path from the project), whatever its case,
 * since a case-insensitive disk opens `claude.local.md` as `CLAUDE.local.md`.
 * Asks git once, for `files`. When git fails (not installed, a repository
 * it won't use) every file counts as tracked.
 * Runs before the project is approved, so the repository's own config must
 * not name a program for git to start or a bare repository for it to use
 */
function trackedFiles(
	root: string,
	files: string[]
): (file: string) => boolean {
	try {
		const out = execFileSync(
			'git',
			[
				'-c',
				'core.fsmonitor=false',
				'-c',
				'safe.bareRepository=explicit',
				'ls-files',
				'-z',
				'--',
				...files.map((file) => `:(icase)${file}`)
			],
			{
				cwd: root,
				encoding: 'utf8',
				stdio: ['ignore', 'pipe', 'ignore'],
				timeout: 10000
			}
		);
		const tracked = new Set(out.toLowerCase().split('\0'));
		return (file) => tracked.has(file.toLowerCase());
	} catch {
		return () => true;
	}
}

const sha256 = (data: string | Buffer) =>
	createHash('sha256').update(data).digest('hex');

/** Bounds on the file walk, which runs before every loop iteration */
const CLAUDE_DIR_MAX_ENTRIES = 5000;
const CLAUDE_DIR_MAX_BYTES = 8 * 1024 * 1024;

/**
 * Every file under `starts` (paths from the project: `.claude` with its
 * rules, agents, commands, skills, hooks and settings, and the rest) as
 * [path, content] pairs in a fixed order, less Claude Code's
 * `.claude/worktrees` and an untracked `.claude/settings.local.json`. A
 * symlink gives its link text, and the content too when it resolves to a
 * file or folder inside the repository (`top`); links that leave it aren't
 * followed. A file past the
 * byte budget gives its size and change times, which rewriting it changes.
 * Past the entry cap the walk stops and a value that never repeats goes in,
 * so loop asks every time.
 * @param tracked - From `trackedFiles`
 */
function fileTree(
	root: string,
	top: string,
	tracked: (file: string) => boolean,
	starts: string[]
): unknown {
	const out: Array<[string, string]> = [];
	let seen = 0;
	let bytes = 0;
	const content = (file: string, stat: fs.Stats) => {
		if (bytes + stat.size > CLAUDE_DIR_MAX_BYTES)
			return `${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
		bytes += stat.size;
		// Bytes, not text: decoding would make different binaries look alike
		return sha256(fs.readFileSync(file));
	};
	const visit = (rel: string): boolean => {
		if (++seen > CLAUDE_DIR_MAX_ENTRIES) return false;
		const full = path.join(root, rel);
		try {
			const stat = fs.lstatSync(full);
			if (stat.isSymbolicLink()) {
				out.push([rel, `link:${fs.readlinkSync(full)}`]);
				const target = fs.realpathSync(full);
				if (isWithin(top, target)) {
					const targetStat = fs.statSync(target);
					if (targetStat.isFile()) out.push([rel, content(target, targetStat)]);
					else if (targetStat.isDirectory()) return walk(rel);
				}
			} else if (stat.isDirectory()) {
				return walk(rel);
			} else if (!stat.isFile()) {
				out.push([rel, 'special']); // A FIFO would block a read
			} else {
				out.push([rel, content(full, stat)]);
			}
		} catch (error) {
			out.push([rel, `error:${(error as NodeJS.ErrnoException).code}`]);
		}
		return true;
	};
	// Through a symlink too; a link loop ends at the entry cap or path length
	const walk = (rel: string): boolean => {
		for (const name of fs.readdirSync(path.join(root, rel)).sort()) {
			if (
				rel === '.claude' &&
				(name === 'worktrees' ||
					(name.toLowerCase() === 'settings.local.json' &&
						!tracked('.claude/settings.local.json')))
			)
				continue;
			if (!visit(`${rel}/${name}`)) return false;
		}
		return true;
	};
	return starts.every(visit) ? out : randomUUID();
}

/**
 * Hash of every tag's tasks, less progress marks and each tag's bookkeeping
 * `metadata`, so set-status or checking off a criterion keeps an approval;
 * with the files in `CLAUDE_FILES` (null when missing), the tracked
 * `LOCAL_FILES`, `.claude`, the Definition of Done, the loop's model
 * settings, the PRD sections tasks cite, which `show` prints with each
 * task, and the complexity reports, whose expansion prompts come with every
 * task. In a project below the repository's top level, also the
 * instructions, rules and skills of each folder above it, which Claude Code
 * loads at start
 */
function trustHash(root: string, home: string): string {
	const folders = foldersToTop(root);
	// Files in the home folder and above are the user's own, as Claude Code's user settings
	const above = (folders?.slice(1) ?? []).filter(
		(dir) => !isWithin(path.resolve(root, dir), home)
	);
	const tracked = folders
		? trackedFiles(root, [
				...LOCAL_FILES,
				TASKGRAPH_LOCAL_CONFIG_FILE,
				...above.map((dir) => `${dir}/CLAUDE.local.md`)
			])
		: () => false;
	const config = projectConfig(root, tracked);
	const doneItems = definitionOfDone(config);
	const sources = new Set<string>();
	let text: string;
	try {
		text = fs.readFileSync(path.join(root, TASKGRAPH_TASKS_FILE), 'utf8');
	} catch {
		text = '';
	}
	try {
		const data = JSON.parse(text);
		// Only a tag's own metadata, not a tag or task that is called `metadata`
		const tags = new Set(
			data && typeof data === 'object' ? Object.values(data) : []
		);
		const marks = progressMarks(doneItems);
		text = JSON.stringify(data, function (key, value) {
			const skip =
				(key === 'metadata' && tags.has(this)) || marks.get(key)?.(value);
			if (!skip && key === PRD_SOURCE_KEY && typeof value === 'string')
				sources.add(value);
			return skip ? undefined : value;
		});
	} catch {
		// Not JSON: hash it as it is, so any change still counts
	}
	// Untracked, CLAUDE.local.md adds nothing, so approvals from before stay valid
	const local = tracked('CLAUDE.local.md') ? ['CLAUDE.local.md'] : [];
	const files = [...CLAUDE_FILES, ...local].map((file) => {
		try {
			return fs.readFileSync(path.join(root, file), 'utf8');
		} catch {
			return null;
		}
	});
	const prd = [...sources].map((s) => readPrdSection(s, root) ?? null);
	// Unset, the model settings add nothing, so approvals from before stay valid
	const models = loopModelSettings(config);
	const starts = [
		'.claude',
		...above.flatMap((dir) => [
			`${dir}/CLAUDE.md`,
			...(tracked(`${dir}/CLAUDE.local.md`) ? [`${dir}/CLAUDE.local.md`] : []),
			`${dir}/.claude/CLAUDE.md`,
			`${dir}/.claude/rules`,
			`${dir}/.claude/skills`
		]),
		// Only when there: approvals from before stay valid without reports
		...(fs.existsSync(path.join(root, REPORTS_DIR)) ? [REPORTS_DIR] : [])
	];
	const top = path.resolve(root, folders?.at(-1) ?? '');
	return sha256(
		JSON.stringify([
			text,
			files,
			fileTree(root, top, tracked, starts),
			[...doneItems],
			prd,
			...(models === undefined ? [] : [models])
		])
	);
}

export function isLoopTrusted(
	projectRoot: string,
	home: string = os.homedir()
): boolean {
	const root = canonical(projectRoot);
	const entry = findEntry(home, root);
	// A bare path from an older version holds no hash: ask again once
	return (
		(entry as TrustEntry | undefined)?.tasks ===
		trustHash(root, canonical(home))
	);
}

/** Approve this project's tasks and instructions as they are now */
export function trustLoop(
	projectRoot: string,
	home: string = os.homedir()
): void {
	const root = canonical(projectRoot);
	updateTrusted(home, (trusted) => withEntry(trusted, root, home));
}

/** The list with this project's entry for its tasks as they are now */
const withEntry = (trusted: unknown[], root: string, home: string) => [
	...trusted.filter((e) => !entryMatches(e, root)),
	{ path: root, tasks: trustHash(root, canonical(home)) }
];

/** Why an approved run stopped: `keepLoopTrust` found the approval withdrawn */
export const TRUST_LOST =
	'Approval for this project was withdrawn during the run: parse-prd, github import or research added to the tasks. Run loop again to approve the tasks as they are now.';

/**
 * Between iterations of an approved run: carry the approval over to the
 * tasks as the run left them (statuses, notes, subtasks Claude added).
 * @returns false when the approval was withdrawn during the run
 */
export function keepLoopTrust(
	projectRoot: string,
	home: string = os.homedir()
): boolean {
	const root = canonical(projectRoot);
	let kept = false;
	updateTrusted(home, (trusted) => {
		kept = trusted.some((e) => typeof e === 'object' && entryMatches(e, root));
		return kept ? withEntry(trusted, root, home) : undefined;
	});
	return kept;
}

/**
 * Ask again before the next unprompted run: tasks came in from outside
 * (a PRD, GitHub issues) that the earlier approval didn't cover
 */
export function untrustLoop(
	projectRoot: string,
	home: string = os.homedir()
): void {
	const root = canonical(projectRoot);
	if (!findEntry(home, root)) return;
	updateTrusted(home, (trusted) =>
		trusted.filter((e) => !entryMatches(e, root))
	);
}

/**
 * Read, change and write the list under a lock, so a withdrawal another
 * process makes between this read and this write isn't lost
 * @param change - The new list, or undefined to leave the file as it is
 */
function updateTrusted(
	home: string,
	change: (trusted: unknown[]) => unknown[] | undefined
): void {
	const file = trustFile(home);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	const release = lockTrusted(file);
	try {
		const trusted = change(readTrusted(home));
		if (!trusted) return;
		// Write beside, then rename, so a crash cannot leave half a file
		const tmp = `${file}.${process.pid}.tmp`;
		fs.writeFileSync(tmp, JSON.stringify(trusted, null, 2));
		fs.renameSync(tmp, file);
	} finally {
		release();
	}
}

/** lockSync takes no retries: try every 20 ms, for up to about 2 seconds */
function lockTrusted(file: string): () => void {
	for (let tries = 1; ; tries++) {
		try {
			return lockfile.lockSync(file, { realpath: false, stale: 10_000 });
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code;
			if (code !== 'ELOCKED' || tries === 100) throw error;
			Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
		}
	}
}
