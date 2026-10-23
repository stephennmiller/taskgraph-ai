/**
 * @fileoverview `loop --parallel`: run the ready tasks side by side, each in
 * its own git worktree and branch, with one Claude Code process per task.
 *
 * 1. Refuse if tracked files have uncommitted changes.
 * 2. Claim up to N tasks from wave 1 (the tasks that can run now), using the
 *    same locked claim as `next --claim`.
 * 3. For each, make `.taskgraph/worktrees/task-<id>` on `taskgraph/task-<id>`
 *    and start `claude -p <prompt>` there, with TASKGRAPH_PROJECT_ROOT set
 *    to this project so its `taskgraph` commands update the main
 *    tasks.json, not the worktree's copy. Output goes to a log file.
 * 4. When all have exited: keep every worktree with commits or changes, and
 *    its claim if Claude didn't mark the task `review`; remove the empty
 *    ones and release their claims.
 *
 * Nothing is ever merged. An abort kills the processes, releases every
 * claim, and keeps the worktrees that have work in them.
 */

import { type ChildProcess, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { getLogger } from '../../../common/logger/index.js';
import { PROJECT_ROOT_ENV } from '../../../common/utils/project-root-finder.js';
import type { TasksDomain } from '../../tasks/tasks-domain.js';
import { resolveClaimant } from '../../tasks/utils/claim.js';
import {
	buildParallelPrompt,
	isSafeTaskId,
	parseParallelCount,
	taskBranchName,
	taskLogPath,
	taskWorktreePath,
	worktreesDir
} from './parallel-plan.js';
import { TaskWorktrees } from './task-worktrees.js';
import type {
	ParallelLoopOptions,
	ParallelLoopResult,
	ParallelTask
} from './types.js';

/** A task with the bits only the runner needs */
interface Running {
	task: ParallelTask;
	/** The worktree exists (made or reused by this run) */
	hasWorktree: boolean;
	/** This run made the branch, so it may delete it if unused */
	createdBranch: boolean;
	child?: ChildProcess;
	exited: Promise<void>;
}

/**
 * Open a task's log for appending. Never through a symlink: one planted
 * there would send Claude's output into whatever file it points at.
 */
function openLog(file: string): number {
	const flags =
		fs.constants.O_WRONLY |
		fs.constants.O_APPEND |
		fs.constants.O_CREAT |
		(fs.constants.O_NOFOLLOW ?? 0);
	let stat: fs.Stats | undefined;
	try {
		stat = fs.lstatSync(file);
	} catch {
		// A new log
	}
	if (stat && !stat.isFile()) {
		throw new Error(`${path.basename(file)} isn't a plain file`);
	}
	return fs.openSync(file, flags, 0o600);
}

const describeSpawnError = (error: NodeJS.ErrnoException, command: string) =>
	error.code === 'ENOENT'
		? `${command} isn't installed or isn't on PATH`
		: `Couldn't start ${command}: ${error.message}`;

export class ParallelLoopRunner {
	private readonly logger = getLogger('ParallelLoopRunner');

	constructor(
		private readonly projectRoot: string,
		private readonly tasks: TasksDomain
	) {}

	async run(options: ParallelLoopOptions): Promise<ParallelLoopResult> {
		const limit = parseParallelCount(options.parallel);
		const { tag, signal, callbacks } = options;
		const command = options.command ?? 'claude';
		const spawner = options.spawner ?? spawn;
		const claimant = options.claimant?.trim() || resolveClaimant();
		const git = new TaskWorktrees(this.projectRoot);

		const base = await git.head();
		await git.assertClean();

		const wave =
			(await this.tasks.getDependencyTree({ tag })).waves.waves[0] ?? [];
		const skippedIds = wave.filter((id) => !isSafeTaskId(id));
		for (const id of skippedIds) {
			this.logger.warn(`Skipping task "${id}": its ID can't be a branch name`);
		}
		const among = new Set(wave.filter(isSafeTaskId));

		const running: Running[] = [];
		let aborted = signal?.aborted ?? false;
		const killTimers: NodeJS.Timeout[] = [];
		// If this process exits before the run is over (a second Ctrl-C, a
		// crash), Claude Code mustn't go on alone with permission prompts off:
		// its process group is in no terminal's way, so kill it here
		const killOnExit = () => {
			for (const r of running) {
				if (r.task.state === 'running' && r.child) {
					this.kill(r.child, 'SIGKILL');
				}
			}
		};
		process.on('exit', killOnExit);
		const stopAll = () => {
			aborted = true;
			for (const r of running) {
				if (r.task.state !== 'running' || !r.child) continue;
				this.kill(r.child, 'SIGTERM');
				const timer = setTimeout(
					() => r.child && this.kill(r.child, 'SIGKILL'),
					options.killGraceMs ?? 5000
				);
				timer.unref();
				killTimers.push(timer);
			}
		};
		signal?.addEventListener('abort', stopAll, { once: true });

		try {
			let ignored = false;
			while (running.length < limit && !aborted && among.size > 0) {
				const claim = await this.tasks.claimNext({ tag, claimant, among });
				if (!claim) break;
				const id = String(claim.task.id);
				among.delete(id);

				const entry: Running = {
					task: {
						id,
						title: claim.task.title,
						branch: taskBranchName(id),
						worktree: taskWorktreePath(this.projectRoot, id),
						logFile: taskLogPath(this.projectRoot, id),
						state: 'running',
						startedAt: Date.now()
					},
					hasWorktree: false,
					createdBranch: false,
					exited: Promise.resolve()
				};
				running.push(entry);

				try {
					if (!ignored) {
						const dir = worktreesDir(this.projectRoot);
						git.prepareWorktreesDir(dir);
						await git.ignoreWorktreesDir(dir);
						ignored = true;
					}
					const { createdBranch } = await git.add(
						entry.task.worktree,
						entry.task.branch,
						base
					);
					entry.hasWorktree = true;
					entry.createdBranch = createdBranch;
					// Awaited before the abort check: an abort that lands while
					// this runs must not be followed by a start
					const cwd = await git.projectIn(entry.task.worktree);
					if (aborted) {
						this.finish(entry, 'stopped');
						callbacks?.onTaskEnd?.({ ...entry.task });
						continue;
					}
					entry.exited = this.start(entry, {
						command,
						spawner,
						cwd,
						prompt: buildParallelPrompt({ taskId: id, tag }),
						isAborted: () => aborted
					});
					callbacks?.onTaskStart?.({ ...entry.task });
					entry.exited = entry.exited.then(() =>
						callbacks?.onTaskEnd?.({ ...entry.task })
					);
				} catch (error) {
					this.finish(
						entry,
						'failed',
						error instanceof Error ? error.message : String(error)
					);
					callbacks?.onTaskEnd?.({ ...entry.task });
				}
			}

			await Promise.all(running.map((r) => r.exited));
		} catch (error) {
			// Something broke mid-setup: don't leave processes behind
			stopAll();
			await Promise.all(running.map((r) => r.exited));
			await this.settle(running, git, base, tag, claimant, true);
			throw error;
		} finally {
			signal?.removeEventListener('abort', stopAll);
			process.off('exit', killOnExit);
			for (const timer of killTimers) clearTimeout(timer);
		}

		await this.settle(running, git, base, tag, claimant, aborted);
		return {
			tasks: running.map((r) => r.task),
			readyCount: wave.length,
			skippedIds,
			aborted
		};
	}

	/** Start Claude Code in the task's worktree; resolves when it's gone */
	private start(
		entry: Running,
		ctx: {
			command: string;
			spawner: NonNullable<ParallelLoopOptions['spawner']>;
			cwd: string;
			prompt: string;
			isAborted: () => boolean;
		}
	): Promise<void> {
		const { task } = entry;
		const log = openLog(task.logFile);
		return new Promise<void>((resolve) => {
			let settled = false;
			const done = (
				state: ParallelTask['state'],
				error?: string,
				exitCode?: number | null
			) => {
				if (settled) return;
				settled = true;
				task.exitCode = exitCode;
				this.finish(entry, state, error);
				resolve();
			};
			try {
				// argv array, no shell: the prompt is one argument whatever it holds
				const child = ctx.spawner(
					ctx.command,
					['-p', ctx.prompt, '--dangerously-skip-permissions'],
					{
						cwd: ctx.cwd,
						// `taskgraph` run in the worktree would otherwise find the
						// worktree's own copy of tasks.json, checked out from HEAD:
						// status changes would land on the branch, and tasks not yet
						// committed would be missing. An env value, never a shell
						env: {
							...process.env,
							[PROJECT_ROOT_ENV]: path.resolve(this.projectRoot)
						},
						stdio: ['ignore', log, log],
						// Own process group, so an abort can stop Claude's children too
						detached: process.platform !== 'win32'
					}
				);
				entry.child = child;
				child.once('error', (error: NodeJS.ErrnoException) =>
					done('failed', describeSpawnError(error, ctx.command))
				);
				child.once('close', (code, sig) => {
					if (ctx.isAborted()) return done('stopped', undefined, code);
					if (code === 0) return done('done', undefined, 0);
					done(
						'failed',
						code === null ? `stopped by ${sig ?? 'a signal'}` : `exit ${code}`,
						code
					);
				});
			} catch (error) {
				done(
					'failed',
					describeSpawnError(error as NodeJS.ErrnoException, ctx.command)
				);
			} finally {
				fs.closeSync(log);
			}
		});
	}

	private finish(
		entry: Running,
		state: ParallelTask['state'],
		error?: string
	): void {
		entry.task.state = state;
		entry.task.durationMs = Date.now() - entry.task.startedAt;
		if (error) entry.task.error = error;
	}

	/** Signal the child's process group (or just the child on Windows) */
	private kill(child: ChildProcess, sig: NodeJS.Signals): void {
		if (child.exitCode !== null || child.signalCode !== null) return;
		try {
			if (process.platform !== 'win32' && child.pid) {
				process.kill(-child.pid, sig);
			} else {
				child.kill(sig);
			}
		} catch {
			try {
				child.kill(sig);
			} catch {
				// Already gone
			}
		}
	}

	/**
	 * After every process is gone: keep worktrees with work, remove the
	 * empty ones, and release claims on tasks with nothing to review (all of
	 * them on abort). Claude updates the task in the main project (see
	 * start), so `claimed` is read back from there: a task Claude marked
	 * `review` is no longer claimed.
	 */
	private async settle(
		running: Running[],
		git: TaskWorktrees,
		base: string,
		tag: string | undefined,
		claimant: string,
		aborted: boolean
	): Promise<void> {
		for (const { task, hasWorktree, createdBranch } of running) {
			let hasWork = false;
			if (hasWorktree) {
				const work = await git.work(task.worktree, task.branch, base);
				task.commits = work.commits;
				task.uncommitted = work.uncommitted;
				hasWork = work.commits > 0 || work.uncommitted;
				task.kept = hasWork
					? true
					: !(await git.remove(task.worktree, task.branch, createdBranch));
			} else {
				task.kept = false;
			}
			if (aborted || !hasWork) await this.release(task.id, tag, claimant);
			task.claimed = await this.isClaimed(task.id, tag, claimant);
		}
	}

	/** Still in-progress under this run's claim (assumed so if unreadable) */
	private async isClaimed(
		id: string,
		tag: string | undefined,
		claimant: string
	): Promise<boolean> {
		try {
			const { task } = await this.tasks.get(id, tag);
			return (
				task?.status === 'in-progress' && task.metadata?.claimedBy === claimant
			);
		} catch {
			return true;
		}
	}

	/** Back to pending, which clears the claim, if it's still ours */
	private async release(
		id: string,
		tag: string | undefined,
		claimant: string
	): Promise<void> {
		try {
			const { task } = await this.tasks.get(id, tag);
			if (
				task?.status !== 'in-progress' ||
				task.metadata?.claimedBy !== claimant
			) {
				return;
			}
			await this.tasks.updateStatus(id, 'pending', tag);
		} catch (error) {
			this.logger.warn(`Couldn't release the claim on task ${id}:`, error);
		}
	}
}
