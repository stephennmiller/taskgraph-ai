/**
 * @fileoverview Per-user record of projects where `loop` may run Claude with
 * permission prompts off. It lives in the home directory, never in the
 * project, so a cloned repo cannot approve itself. Each approval holds a hash
 * of the tasks it was given for, so tasks that changed since (another branch,
 * a pull, a hand edit) need a new one.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import lockfile from 'proper-lockfile';
import { TASK_STATUSES } from '../../common/constants/index.js';
import { TASKGRAPH_TASKS_FILE } from '../../common/constants/paths.js';

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
 */
const PROGRESS_MARKS = new Map<string, (value: unknown) => boolean>([
	['status', (v) => v === 'completed' || TASK_STATUSES.includes(v as never)],
	['updatedAt', (v) => typeof v === 'string' && /^[\d:.TZ+-]*$/.test(v)],
	['checked', (v) => typeof v === 'boolean']
]);

/**
 * Hash of every tag's tasks, less progress marks and each tag's bookkeeping
 * `metadata`, so set-status or checking off a criterion keeps an approval
 */
function tasksHash(root: string): string {
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
		text = JSON.stringify(data, function (key, value) {
			const skip =
				(key === 'metadata' && tags.has(this)) ||
				PROGRESS_MARKS.get(key)?.(value);
			return skip ? undefined : value;
		});
	} catch {
		// Not JSON: hash it as it is, so any change still counts
	}
	return createHash('sha256').update(text).digest('hex');
}

export function isLoopTrusted(
	projectRoot: string,
	home: string = os.homedir()
): boolean {
	const root = canonical(projectRoot);
	const entry = findEntry(home, root);
	// A bare path from an older version holds no hash: ask again once
	return (entry as TrustEntry | undefined)?.tasks === tasksHash(root);
}

/** Approve this project's tasks as they are now */
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
	{ path: root, tasks: tasksHash(root) }
];

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
