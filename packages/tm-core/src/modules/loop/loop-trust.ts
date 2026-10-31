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
	TASKGRAPH_CONFIG_FILE,
	TASKGRAPH_TASKS_FILE
} from '../../common/constants/paths.js';
import { isWithin } from '../../common/utils/project-root-finder.js';
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

/** The project's Definition of Done, as `ConfigManager` reads it */
function definitionOfDone(root: string): Set<string> {
	try {
		const config = JSON.parse(
			fs.readFileSync(path.join(root, TASKGRAPH_CONFIG_FILE), 'utf8')
		);
		return new Set(normalizeDefinitionOfDone(config?.global?.definitionOfDone));
	} catch {
		return new Set();
	}
}

/**
 * `loop.bands` and `loop.resumeMaxContextTokens`, which pick each iteration's
 * model, effort and resume; undefined when neither is set
 */
function loopModelSettings(root: string): unknown {
	try {
		const loop = JSON.parse(
			fs.readFileSync(path.join(root, TASKGRAPH_CONFIG_FILE), 'utf8')
		)?.loop;
		const settings = [loop?.bands, loop?.resumeMaxContextTokens];
		return settings.some((v) => v !== undefined) ? settings : undefined;
	} catch {
		return undefined;
	}
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

/**
 * Which of `LOCAL_FILES` git tracks, in one call; none outside a repository.
 * Runs before the project is approved, so the repository's own config must
 * not name a program for git to start or a bare repository for it to use
 */
function trackedLocalFiles(root: string): Set<string> {
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
				...LOCAL_FILES
			],
			{
				cwd: root,
				encoding: 'utf8',
				stdio: ['ignore', 'pipe', 'ignore'],
				timeout: 10000
			}
		);
		return new Set(out.split('\0'));
	} catch {
		return new Set();
	}
}

const sha256 = (data: string | Buffer) =>
	createHash('sha256').update(data).digest('hex');

/** Bounds on the `.claude` walk, which runs before every loop iteration */
const CLAUDE_DIR_MAX_ENTRIES = 5000;
const CLAUDE_DIR_MAX_BYTES = 8 * 1024 * 1024;

/**
 * Everything under `.claude` (rules, agents, commands, skills, hooks,
 * settings) as [path, content] pairs in a fixed order, less Claude Code's
 * `worktrees` and an untracked `settings.local.json`. A symlink gives its
 * link text, and the content too when it resolves to a file or folder
 * inside the project; links that leave the project aren't followed. A file past the
 * byte budget gives its size and change times, which rewriting it changes.
 * Past the entry cap the walk stops and a value that never repeats goes in,
 * so loop asks every time.
 * @param tracked - From `trackedLocalFiles`
 */
function claudeDir(root: string, tracked: Set<string>): unknown {
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
				if (isWithin(root, target)) {
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
					(name === 'settings.local.json' &&
						!tracked.has('.claude/settings.local.json')))
			)
				continue;
			if (!visit(`${rel}/${name}`)) return false;
		}
		return true;
	};
	return visit('.claude') ? out : randomUUID();
}

/**
 * Hash of every tag's tasks, less progress marks and each tag's bookkeeping
 * `metadata`, so set-status or checking off a criterion keeps an approval;
 * with the files in `CLAUDE_FILES` (null when missing), the tracked
 * `LOCAL_FILES`, `.claude`, the Definition of Done, the loop's model
 * settings and the PRD sections tasks cite, which `show` prints with each task
 */
function trustHash(root: string): string {
	const doneItems = definitionOfDone(root);
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
	const tracked = trackedLocalFiles(root);
	// Untracked, CLAUDE.local.md adds nothing, so approvals from before stay valid
	const local = tracked.has('CLAUDE.local.md') ? ['CLAUDE.local.md'] : [];
	const files = [...CLAUDE_FILES, ...local].map((file) => {
		try {
			return fs.readFileSync(path.join(root, file), 'utf8');
		} catch {
			return null;
		}
	});
	const prd = [...sources].map((s) => readPrdSection(s, root) ?? null);
	// Unset, the model settings add nothing, so approvals from before stay valid
	const models = loopModelSettings(root);
	return sha256(
		JSON.stringify([
			text,
			files,
			claudeDir(root, tracked),
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
	return (entry as TrustEntry | undefined)?.tasks === trustHash(root);
}

/** Approve this project's tasks and instructions as they are now */
export function trustLoop(
	projectRoot: string,
	home: string = os.homedir()
): void {
	const root = canonical(projectRoot);
	updateTrusted(home, (trusted) => withEntry(trusted, root));
}

/** The list with this project's entry for its tasks as they are now */
const withEntry = (trusted: unknown[], root: string) => [
	...trusted.filter((e) => !entryMatches(e, root)),
	{ path: root, tasks: trustHash(root) }
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
		return kept ? withEntry(trusted, root) : undefined;
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
