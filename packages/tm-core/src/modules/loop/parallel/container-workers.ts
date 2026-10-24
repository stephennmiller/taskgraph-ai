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

/** The project's TaskGraph files a worker gets a copy of */
const STATE_FILES = [
	'tasks/tasks.json',
	'config.json',
	'config.local.json',
	'state.json'
];

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
 * `.git` that holds commands or points outside it, and write a fresh
 * config. Each entry removed sits in a folder checked to be real, and
 * fs.rmSync removes a symlink rather than following it.
 * @throws ParallelLoopError when `.git` (or its objects or refs) isn't a
 *   real folder
 */
export function sanitizeClone(clone: string, gitConfig: string): void {
	const gitDir = path.join(clone, '.git');
	for (const dir of [
		clone,
		gitDir,
		path.join(gitDir, 'objects'),
		path.join(gitDir, 'refs')
	]) {
		if (!isRealDir(dir)) {
			throw new ParallelLoopError(
				`${dir} isn't a real folder; don't run git there`
			);
		}
	}
	for (const entry of UNTRUSTED_GIT_ENTRIES) {
		fs.rmSync(path.join(gitDir, entry), { recursive: true, force: true });
	}
	fs.writeFileSync(path.join(gitDir, 'config'), gitConfig, { flag: 'wx' });
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
		prompt: string
	): Promise<{ name: string; createdBranch: boolean; args: string[] }> {
		const clone = this.clone(task);
		const createdBranch = !(await this.git.branchExists(task.branch));
		if (lstatOrNull(clone)) {
			if (!isRealDir(clone) || !isRealDir(path.join(clone, '.git'))) {
				throw new ParallelLoopError(
					`${path.relative(this.projectRoot, clone)} already exists and isn't a task clone`,
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
		fs.rmSync(stateDir, { recursive: true, force: true });
		for (const file of STATE_FILES) {
			const from = path.join(this.projectRoot, '.taskgraph', file);
			if (!fs.existsSync(from)) continue;
			const to = path.join(stateDir, '.taskgraph', file);
			fs.mkdirSync(path.dirname(to), { recursive: true });
			fs.copyFileSync(from, to);
		}

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
				taskgraphPackage: `taskgraph-ai@${TASKGRAPH_VERSION}`,
				user:
					process.getuid && process.getgid
						? `${process.getuid()}:${process.getgid()}`
						: undefined
			})
		};
	}

	/**
	 * Remove containers by name and wait for it: a killed docker client
	 * doesn't stop its container. Synchronous, so it works in an exit handler.
	 */
	stop(names: string[]): void {
		if (names.length === 0) return;
		spawnSync(this.setup.runtime, ['rm', '--force', ...names], {
			stdio: 'ignore',
			timeout: 60_000
		});
	}

	/** The status the worker set, read from its copy; see readWorkerStatus */
	readStatus(task: ParallelTask, tag: string): TaskStatus | undefined {
		return readWorkerStatus(this.stateDir(task), task.id, tag);
	}

	/**
	 * After the container is gone: fetch the branch, then remove the clone
	 * unless the fetch failed or the run was stopped. Sets the task's
	 * commits, kept and (on a failed fetch) error.
	 * @returns Whether the task has work to keep its claim for
	 */
	async bringBack(
		task: ParallelTask,
		base: string,
		createdBranch: boolean,
		aborted: boolean
	): Promise<boolean> {
		const clone = this.clone(task);
		let fetched = false;
		try {
			sanitizeClone(clone, this.setup.gitConfig);
			await this.git.fetchFromClone(clone, task.branch);
			fetched = true;
		} catch (error) {
			const why = error instanceof Error ? error.message : String(error);
			task.state = 'failed';
			task.error = `couldn't bring the branch back (${why.split('\n')[0]}); its clone is kept in ${path.relative(this.projectRoot, clone)}`;
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
		return task.kept;
	}
}
