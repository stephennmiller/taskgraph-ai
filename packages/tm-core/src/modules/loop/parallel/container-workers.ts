/**
 * @fileoverview `loop --parallel --container`: the host side of each
 * worker. Before a container starts, the host makes the worker's own clone
 * (`.taskgraph/worktrees/task-<id>`) and a copy of the project's TaskGraph
 * files (`task-<id>.state`), and those two folders are all the container
 * mounts. Once the container is gone, the host:
 *
 * 1. reads only this task's status from the copy's tasks.json (untrusted)
 * 2. replaces the clone's git config and removes its hooks, then fetches the
 *    task branch into the project's repository, running git here, not there
 * 3. removes the clone, or keeps it when the fetch failed or the run was
 *    stopped (its uncommitted work would be lost otherwise)
 *
 * Everything in both folders was writable by the container, so the host
 * reads them as data and never runs git inside the clone before step 2.
 */

import { execFile, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { TASKGRAPH_VERSION } from '../../../common/constants/index.js';
import type { TaskStatus } from '../../../common/types/index.js';
import {
	CONTAINER_RUNTIME,
	MAX_IMPORTED_TASKS_BYTES,
	assertMountablePath,
	buildContainerArgs,
	checkContainerSetup,
	cloneGitConfig,
	containerRuntimeDown,
	containerRuntimeMissing,
	importedStatus
} from './container.js';
import { ParallelLoopError, worktreesDir } from './parallel-plan.js';
import type { TaskWorktrees } from './task-worktrees.js';
import type { ParallelTask } from './types.js';

/** What every worker in a run shares, found once before anything is claimed */
export interface ContainerSetup {
	runtime: string;
	image: string;
	tokenVar: string;
	/** The clone's git config (see cloneGitConfig) */
	gitConfig: string;
}

/**
 * The project's TaskGraph files a worker gets a copy of. Not
 * config.local.json: it can hold API keys, and the container has network.
 */
const STATE_FILES = ['tasks/tasks.json', 'config.json', 'state.json'];

/** A clone's `.git` bigger than this, or with more entries, isn't fetched from */
const MAX_CLONE_GIT_BYTES = 4 * 1024 ** 3;
const MAX_CLONE_GIT_ENTRIES = 1_000_000;

/**
 * Everything `--container` needs, checked before the first claim: platform,
 * image name, token, a running runtime, a git identity, and project paths
 * that fit in a `--mount`.
 * @throws ParallelLoopError for the first one that's missing
 */
export async function preflightContainer(
	projectRoot: string,
	git: TaskWorktrees,
	options: { image?: string; runtime?: string }
): Promise<ContainerSetup> {
	const { image, tokenVar } = checkContainerSetup({
		image: options.image,
		env: process.env,
		platform: process.platform
	});
	assertMountablePath(worktreesDir(fs.realpathSync(projectRoot)));
	const runtime = options.runtime ?? CONTAINER_RUNTIME;
	try {
		await promisify(execFile)(runtime, [
			'version',
			'--format',
			'{{.Server.Version}}'
		]);
	} catch (error) {
		throw (error as NodeJS.ErrnoException).code === 'ENOENT'
			? containerRuntimeMissing(runtime)
			: containerRuntimeDown(runtime);
	}
	await git.head(); // a clear error outside a repository
	const identity = await git.identity();
	if (!identity) {
		throw new ParallelLoopError(
			'--container needs git user.name and user.email set',
			'Run `git config --global user.email you@example.com`, and user.name'
		);
	}
	return {
		runtime,
		image,
		tokenVar,
		gitConfig: cloneGitConfig({
			objectFormat: await git.objectFormat(),
			userName: identity.name,
			userEmail: identity.email
		})
	};
}

const lstatOrNull = (p: string): fs.Stats | null => {
	try {
		return fs.lstatSync(p);
	} catch {
		return null;
	}
};

const isRealDir = (p: string) => {
	const stat = lstatOrNull(p);
	return !!stat && stat.isDirectory() && !stat.isSymbolicLink();
};

/** What in a clone's `.git` can make git run a command or read elsewhere */
const UNTRUSTED_GIT_ENTRIES = [
	'config',
	'config.worktree',
	'hooks',
	'info',
	'modules',
	'commondir',
	'gitdir',
	'worktrees',
	'shallow',
	'objects/info'
];

/**
 * Make a worker's clone safe for the host's git: remove everything in its
 * `.git` that holds commands or points outside it, check that all that's
 * left is plain folders and files (a symlink, FIFO or device would have the
 * host's git read, or hang on, something outside the clone), and write a
 * fresh config. fs.rmSync removes a symlink rather than following it.
 * @throws ParallelLoopError naming the first entry that isn't plain, or
 *   when the `.git` folder is too big or has too many entries
 */
export function sanitizeClone(
	clone: string,
	gitConfig: string,
	maxBytes = MAX_CLONE_GIT_BYTES,
	maxEntries = MAX_CLONE_GIT_ENTRIES
): void {
	const gitDir = path.join(clone, '.git');
	const refuse = (p: string, why: string) =>
		new ParallelLoopError(`${path.relative(clone, p) || '.'} ${why}`);
	for (const dir of [clone, gitDir]) {
		if (!isRealDir(dir)) throw refuse(dir, "isn't a plain folder");
	}
	for (const entry of UNTRUSTED_GIT_ENTRIES) {
		fs.rmSync(path.join(gitDir, entry), { recursive: true, force: true });
	}
	for (const dir of ['objects', 'refs']) {
		if (!isRealDir(path.join(gitDir, dir))) {
			throw refuse(path.join(gitDir, dir), "isn't a plain folder");
		}
	}
	let total = 0;
	let entries = 0;
	const pending = [gitDir];
	while (pending.length > 0) {
		const dir = pending.pop() as string;
		for (const name of fs.readdirSync(dir)) {
			if (++entries > maxEntries) {
				throw refuse(gitDir, 'has too many files to fetch from');
			}
			const p = path.join(dir, name);
			const stat = fs.lstatSync(p);
			if (stat.isDirectory()) {
				pending.push(p);
			} else if (stat.isFile()) {
				total += stat.size;
				if (total > maxBytes) throw refuse(gitDir, 'is too big to fetch from');
			} else {
				throw refuse(p, "isn't a plain file or folder");
			}
		}
	}
	fs.writeFileSync(path.join(gitDir, 'config'), gitConfig, { flag: 'wx' });
}

/** The last line git wrote to stderr, else the error's first line */
function gitReason(error: unknown): string {
	const stderr = (error as { stderr?: unknown })?.stderr;
	const last =
		typeof stderr === 'string'
			? stderr.trim().split('\n').pop()?.trim()
			: undefined;
	if (last) return last.replace(/^(fatal|error): /, '');
	return (error instanceof Error ? error.message : String(error)).split(
		'\n'
	)[0];
}

/**
 * The status the worker gave a task in its copy of tasks.json: undefined
 * when the file is missing, outside the folder, not a plain file, too big,
 * or doesn't hold a known status for the task.
 */
export function readWorkerStatus(
	stateDir: string,
	taskId: string,
	tag: string
): TaskStatus | undefined {
	try {
		const root = fs.realpathSync(stateDir);
		const file = fs.realpathSync(
			path.join(stateDir, '.taskgraph', 'tasks', 'tasks.json')
		);
		if (!file.startsWith(root + path.sep)) return undefined;
		const stat = fs.lstatSync(file);
		if (!stat.isFile() || stat.size > MAX_IMPORTED_TASKS_BYTES) {
			return undefined;
		}
		return importedStatus(fs.readFileSync(file, 'utf8'), taskId, tag);
	} catch {
		return undefined;
	}
}

/**
 * A fresh copy of the project's TaskGraph files (STATE_FILES) for a worker.
 * Plain files only: a symlink would copy whatever it points at.
 */
export function copyStateFiles(projectRoot: string, stateDir: string): void {
	fs.rmSync(stateDir, { recursive: true, force: true });
	for (const file of STATE_FILES) {
		const from = path.join(projectRoot, '.taskgraph', file);
		if (!lstatOrNull(from)?.isFile()) continue;
		const to = path.join(stateDir, '.taskgraph', file);
		fs.mkdirSync(path.dirname(to), { recursive: true });
		fs.copyFileSync(from, to);
	}
}

export class ContainerWorkers {
	constructor(
		/** Symlinks resolved: the container sees only real paths */
		private readonly projectRoot: string,
		private readonly git: TaskWorktrees,
		private readonly setup: ContainerSetup
	) {}

	/** The task's clone; its folder was checked to be real (prepareWorktreesDir) */
	private clone(task: ParallelTask): string {
		const dir = path.dirname(task.worktree);
		return path.join(fs.realpathSync(dir), path.basename(task.worktree));
	}

	get runtime(): string {
		return this.setup.runtime;
	}

	private stateDir(task: ParallelTask): string {
		return `${this.clone(task)}.state`;
	}

	/**
	 * Make (or reuse, after a stopped run) the task's clone and a fresh copy
	 * of the project's TaskGraph files.
	 * @returns The container's name, whether the branch is new to this
	 *   repository, and the `docker run` arguments
	 */
	async prepare(
		task: ParallelTask,
		base: string,
		prompt: string,
		claudeArgs: string[]
	): Promise<{ name: string; createdBranch: boolean; args: string[] }> {
		const clone = this.clone(task);
		const createdBranch = !(await this.git.branchExists(task.branch));
		const shown = path.relative(this.projectRoot, clone);
		if (lstatOrNull(clone)) {
			await this.assertNoContainer(task.id);
			if (lstatOrNull(path.join(clone, '.git'))?.isFile()) {
				throw new ParallelLoopError(
					`${shown} is a worktree from a run without --container`,
					`Run without --container, or remove it: \`git worktree remove ${shown}\``
				);
			}
			if (!isRealDir(clone) || !isRealDir(path.join(clone, '.git'))) {
				throw new ParallelLoopError(
					`${shown} already exists and isn't a task clone`,
					'Move or delete it, then try again'
				);
			}
		} else {
			await this.git.cloneFor(
				clone,
				task.branch,
				createdBranch ? base : `refs/heads/${task.branch}`
			);
		}
		sanitizeClone(clone, this.setup.gitConfig);

		const stateDir = this.stateDir(task);
		copyStateFiles(this.projectRoot, stateDir);

		const name = `taskgraph-task-${task.id}-${randomBytes(4).toString('hex')}`;
		return {
			name,
			createdBranch,
			args: buildContainerArgs({
				image: this.setup.image,
				tokenVar: this.setup.tokenVar,
				name,
				clone,
				cwd: await this.git.projectIn(clone),
				stateDir,
				prompt,
				claudeArgs,
				taskgraphPackage: `taskgraph-ai@${TASKGRAPH_VERSION}`,
				user:
					process.getuid && process.getgid
						? `${process.getuid()}:${process.getgid()}`
						: undefined
			})
		};
	}

	/**
	 * A kept clone may still be mounted by a container from an earlier run
	 * that wasn't removed; reusing it would let that container keep writing.
	 * @throws ParallelLoopError when one is listed or the list can't be read
	 */
	private async assertNoContainer(id: string): Promise<void> {
		const runtime = path.basename(this.setup.runtime);
		let stdout: string;
		try {
			({ stdout } = await promisify(execFile)(this.setup.runtime, [
				'ps',
				'-a',
				'--format',
				'{{.Names}}',
				'--filter',
				`name=^/?taskgraph-task-${id}-`
			]));
		} catch (error) {
			throw new ParallelLoopError(
				`couldn't check that task ${id} has no container left (${gitReason(error)})`,
				`Check with ${runtime} ps -a, then try again`
			);
		}
		const names = stdout.trim().split(/\s+/).filter(Boolean).join(' ');
		if (names) {
			throw new ParallelLoopError(
				`task ${id} still has a container; remove it with ${runtime} rm -f ${names}`,
				`Remove it: ${runtime} rm -f ${names}`
			);
		}
	}

	/**
	 * Remove containers by name: a killed docker client doesn't stop its
	 * container. Synchronous, so it works in an exit handler.
	 * @returns The ones that may still be there (`container inspect` didn't
	 *   say they're gone)
	 */
	stop(names: string[]): string[] {
		if (names.length === 0) return [];
		const run = (args: string[]) =>
			spawnSync(this.setup.runtime, args, {
				stdio: 'ignore',
				timeout: 60_000
			});
		run(['rm', '--force', ...names]);
		// Gone only when inspect says so; a timeout or error counts as still there
		const left = names.filter((name) => {
			const { status } = run(['container', 'inspect', name]);
			return status === 0 || status === null;
		});
		// An unreachable daemon fails inspect like "No such container" does
		const daemonUp =
			left.length === names.length ||
			run(['version', '--format', '{{.Server.Version}}']).status === 0;
		return daemonUp ? left : names;
	}

	/** The status the worker set, read from its copy; see readWorkerStatus */
	readStatus(task: ParallelTask, tag: string): TaskStatus | undefined {
		return readWorkerStatus(this.stateDir(task), task.id, tag);
	}

	/**
	 * After the container is gone: fetch the branch, then remove the clone
	 * unless the fetch failed or the run was stopped. A clone whose `.git`
	 * can't be made safe loses its `.git`; its files stay. Sets the task's
	 * commits, kept and (on failure) error.
	 */
	async bringBack(
		task: ParallelTask,
		base: string,
		createdBranch: boolean,
		aborted: boolean
	): Promise<{ fetched: boolean; hasWork: boolean }> {
		const clone = this.clone(task);
		const shown = path.relative(this.projectRoot, clone);
		let fetched = false;
		try {
			sanitizeClone(clone, this.setup.gitConfig);
			try {
				await this.git.fetchFromClone(clone, task.branch);
				fetched = true;
			} catch (error) {
				task.state = 'failed';
				task.error = `couldn't bring the branch back (${gitReason(error).replaceAll(clone, shown)}); its clone is kept in ${shown}`;
			}
		} catch (error) {
			fs.rmSync(path.join(clone, '.git'), { recursive: true, force: true });
			task.state = 'failed';
			task.error = `its git data was unsafe (${gitReason(error)}), so it was removed; the files are kept in ${shown}`;
		}
		fs.rmSync(this.stateDir(task), { recursive: true, force: true });
		task.commits = await this.git.commitsSince(task.branch, base);
		const keepClone = !fetched || aborted;
		if (!keepClone) {
			fs.rmSync(clone, { recursive: true, force: true });
			if (task.commits === 0 && createdBranch) {
				await this.git.deleteBranch(task.branch);
			}
		}
		task.kept = task.commits > 0 || keepClone;
		return { fetched, hasWork: task.kept };
	}
}
