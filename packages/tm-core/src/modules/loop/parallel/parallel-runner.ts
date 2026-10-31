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
 *    its claim if Claude finished without marking the task `review`; remove
 *    the empty ones and release their claims. A failed task's claim is
 *    released too, so a later run retries it in the kept worktree.
 *
 * Nothing is ever merged. An abort kills the processes, releases every
 * claim, and keeps the worktrees that have work in them.
 */

import { type ChildProcess, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { getLogger } from '../../../common/logger/index.js';
import type { TaskStatus } from '../../../common/types/index.js';
import { PROJECT_ROOT_ENV } from '../../../common/utils/project-root-finder.js';
import { childAutoUpdateEnv } from '../child-env.js';
import { OWN_PROCESS_GROUP, killProcessGroup } from '../process-group.js';
import type { TasksDomain } from '../../tasks/tasks-domain.js';
import { resolveClaimant } from '../../tasks/utils/claim.js';
import { ContainerWorkers, preflightContainer } from './container-workers.js';
import {
	buildParallelPrompt,
	parseParallelCount,
	taskBranchName,
	taskLogPath,
	taskWorktreePath,
	worktreesDir
} from './parallel-plan.js';
import { isSafeTaskId } from '../../../common/utils/safe-task-id.js';
import {
	capArgs,
	loopIterationTimeoutMs,
	timeoutMessage
} from '../services/iteration-limits.js';
import {
	STREAM_JSON_ARGS,
	findResultEvent,
	hasStreamEvent
} from '../services/stream-events.js';
import { TaskWorktrees } from './task-worktrees.js';
import {
	type LoopBand,
	type ModelChoice,
	modelArgs,
	pickModelEffort
} from '../model-bands.js';
import { isFinishedStatus } from '../task-progress.js';
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
	/** With --container: the container's name, for removing it */
	container?: string;
	child?: ChildProcess;
	/** Stopped for running past TASKGRAPH_LOOP_TIMEOUT_MS */
	timedOut?: boolean;
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

/** The cost and turns at the end of a task's log, if Claude Code got that far */
function readSpend(task: ParallelTask, from: number): void {
	try {
		// From where this run started: a rerun appends to the failed run's log
		const log = fs.readFileSync(task.logFile).subarray(from);
		const text = log.toString('utf8');
		const run = findResultEvent(text);
		if (run?.costUsd !== undefined) task.costUsd = run.costUsd;
		// Started, then killed or crashed before its result event (#861)
		else if (hasStreamEvent(text)) task.costUnknown = true;
		if (run?.turns !== undefined) task.turns = run.turns;
	} catch {
		// No log (the spawn failed): nothing was spent
	}
}

const describeSpawnError = (error: NodeJS.ErrnoException, command: string) =>
	error.code === 'ENOENT'
		? `${command} isn't installed or isn't on PATH`
		: `Couldn't start ${command}: ${error.message}`;

export class ParallelLoopRunner {
	private readonly logger = getLogger('ParallelLoopRunner');

	constructor(
		private readonly projectRoot: string,
		private readonly tasks: TasksDomain,
		/** The tag a run without --tag works on */
		private readonly activeTag: () => string,
		/** Complexity bands that pick each task's model and effort */
		private readonly bands: LoopBand[] = []
	) {}

	async run(options: ParallelLoopOptions): Promise<ParallelLoopResult> {
		const limit = parseParallelCount(options.parallel);
		const { tag, signal, callbacks } = options;
		const command = options.command ?? 'claude';
		const spawner = options.spawner ?? spawn;
		const claimant = options.claimant?.trim() || resolveClaimant();
		// stream-json, so the log ends with the cost; the budget split evenly
		const claudeArgs = [
			...STREAM_JSON_ARGS,
			...capArgs({
				maxTurns: options.maxTurns,
				maxBudgetUsd:
					options.maxBudgetUsd === undefined
						? undefined
						: options.maxBudgetUsd / limit
			})
		];
		const git = new TaskWorktrees(this.projectRoot);
		// Checked before anything is claimed, so a missing runtime or token
		// costs nothing
		const workers =
			options.container &&
			new ContainerWorkers(
				fs.realpathSync(this.projectRoot),
				git,
				await preflightContainer(this.projectRoot, git, options.container)
			);

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
		const runningContainers = () =>
			running.flatMap((r) =>
				r.task.state === 'running' && r.container ? [r.container] : []
			);
		const killOnExit = () => {
			// Killing the docker client leaves its container running
			workers?.stop(runningContainers());
			for (const r of running) {
				if (r.task.state === 'running' && r.child) {
					killProcessGroup(r.child, 'SIGKILL');
				}
			}
		};
		process.on('exit', killOnExit);
		const stopAll = () => {
			aborted = true;
			workers?.stop(runningContainers());
			for (const r of running) {
				if (r.task.state !== 'running' || !r.child) continue;
				killTimers.push(this.terminate(r.child, options.killGraceMs ?? 5000));
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
					// Awaited before the abort check: an abort that lands while
					// this runs must not be followed by a start
					const prompt = buildParallelPrompt({
						taskId: id,
						tag,
						container: !!workers
					});
					const choice = await this.chooseModel(id, tag, options.model);
					Object.assign(entry.task, choice);
					const taskArgs = [...claudeArgs, ...modelArgs(choice)];
					let cmd = command;
					let args = [
						'-p',
						prompt,
						'--dangerously-skip-permissions',
						...taskArgs
					];
					let cwd: string;
					await git.assertBranchReusable(entry.task.branch, base);
					if (workers) {
						const prepared = await workers.prepare(
							entry.task,
							base,
							prompt,
							taskArgs
						);
						entry.hasWorktree = true;
						entry.createdBranch = prepared.createdBranch;
						entry.container = prepared.name;
						cmd = workers.runtime;
						args = prepared.args;
						cwd = this.projectRoot;
					} else {
						const { createdBranch } = await git.add(
							entry.task.worktree,
							entry.task.branch,
							base
						);
						entry.hasWorktree = true;
						entry.createdBranch = createdBranch;
						cwd = await git.projectIn(entry.task.worktree);
					}
					if (aborted) {
						this.finish(entry, 'stopped');
						callbacks?.onTaskEnd?.({ ...entry.task });
						continue;
					}
					entry.exited = this.start(entry, {
						command: cmd,
						args,
						spawner,
						cwd,
						isAborted: () => aborted,
						killGraceMs: options.killGraceMs ?? 5000,
						workers
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
			await this.settle(running, git, workers, base, tag, claimant, true);
			throw error;
		} finally {
			signal?.removeEventListener('abort', stopAll);
			process.off('exit', killOnExit);
			for (const timer of killTimers) clearTimeout(timer);
		}

		await this.settle(running, git, workers, base, tag, claimant, aborted);
		const costs = running.flatMap((r) =>
			r.task.costUsd === undefined ? [] : [r.task.costUsd]
		);
		return {
			tasks: running.map((r) => r.task),
			readyCount: wave.length,
			skippedIds,
			aborted,
			...(costs.length
				? { totalCostUsd: costs.reduce((a, b) => a + b, 0) }
				: {}),
			...(running.some((r) => r.task.costUnknown) ? { costPartial: true } : {})
		};
	}

	/** The model and effort for a task, from its complexity score (none if unreadable) */
	private async chooseModel(
		id: string,
		tag: string | undefined,
		model: string | undefined
	): Promise<ModelChoice> {
		const score = await this.tasks
			.get(id, tag)
			.then((found) => found.task?.complexity)
			.catch(() => undefined);
		return pickModelEffort(score, this.bands, model);
	}

	/** Start Claude Code in the task's worktree; resolves when it's gone */
	private start(
		entry: Running,
		ctx: {
			command: string;
			args: string[];
			spawner: NonNullable<ParallelLoopOptions['spawner']>;
			cwd: string;
			isAborted: () => boolean;
			killGraceMs: number;
			workers: ContainerWorkers | undefined;
		}
	): Promise<void> {
		const { task } = entry;
		const log = openLog(task.logFile);
		const logStart = fs.fstatSync(log).size;
		const timeout = loopIterationTimeoutMs();
		const timers: NodeJS.Timeout[] = [];
		return new Promise<void>((resolve) => {
			let settled = false;
			const done = (
				state: ParallelTask['state'],
				error?: string,
				exitCode?: number | null
			) => {
				if (settled) return;
				settled = true;
				for (const timer of timers) clearTimeout(timer);
				task.exitCode = exitCode;
				readSpend(task, logStart);
				this.finish(entry, state, error);
				resolve();
			};
			try {
				// argv array, no shell: the prompt is one argument whatever it holds
				const child = ctx.spawner(ctx.command, ctx.args, {
					cwd: ctx.cwd,
					// `taskgraph` run in the worktree would otherwise find the
					// worktree's own copy of tasks.json, checked out from HEAD:
					// status changes would land on the branch, and tasks not yet
					// committed would be missing. An env value, never a shell.
					// The marker and TASKGRAPH_SKIP_AUTO_UPDATE stop the worker
					// from installing an update.
					env: childAutoUpdateEnv('parallel', {
						...process.env,
						[PROJECT_ROOT_ENV]: path.resolve(this.projectRoot)
					}),
					stdio: ['ignore', log, log],
					// Own process group, so an abort can stop Claude's children too
					detached: OWN_PROCESS_GROUP
				});
				entry.child = child;
				// A hung worker would hold up the whole run: stop it like an abort does
				timers.push(
					setTimeout(() => {
						entry.timedOut = true;
						// Killing the docker client leaves its container running
						if (entry.container) ctx.workers?.stop([entry.container]);
						timers.push(this.terminate(child, ctx.killGraceMs));
					}, timeout)
				);
				child.once('error', (error: NodeJS.ErrnoException) =>
					done('failed', describeSpawnError(error, ctx.command))
				);
				child.once('close', (code, sig) => {
					if (ctx.isAborted()) return done('stopped', undefined, code);
					if (entry.timedOut)
						return done('failed', timeoutMessage(timeout), code);
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

	/** SIGTERM now, SIGKILL after the grace period; returns the SIGKILL timer */
	private terminate(child: ChildProcess, graceMs: number): NodeJS.Timeout {
		killProcessGroup(child, 'SIGTERM');
		const timer = setTimeout(() => killProcessGroup(child, 'SIGKILL'), graceMs);
		timer.unref();
		return timer;
	}

	/**
	 * After every process is gone: keep worktrees with work, remove the
	 * empty ones, and release claims on failed tasks and tasks with nothing
	 * to review (all of them on abort). Claude updates the task in the main
	 * project (see start), so `claimed` is read back from there: a task Claude marked
	 * `review` is no longer claimed. With --container, every container is
	 * removed first, and the work comes back through ContainerWorkers.
	 */
	private async settle(
		running: Running[],
		git: TaskWorktrees,
		workers: ContainerWorkers | undefined,
		base: string,
		tag: string | undefined,
		claimant: string,
		aborted: boolean
	): Promise<void> {
		const stuck = new Set(
			workers?.stop(running.flatMap((r) => (r.container ? [r.container] : [])))
		);
		for (const {
			task,
			hasWorktree,
			createdBranch,
			container,
			timedOut
		} of running) {
			let hasWork = false;
			const isStuck = !!container && stuck.has(container);
			// Claude failed: free the task so a later run retries it in the kept worktree
			let releaseClaim = !isStuck && (aborted || task.state === 'failed');
			if (isStuck) {
				// It may still be writing to the clone: leave the clone and claim
				task.state = 'failed';
				task.error = `its container may still be running; remove it with docker rm -f ${container}`;
				task.kept = true;
				hasWork = true;
			} else if (workers && hasWorktree) {
				// Read before bringBack removes the copy; applied only if the
				// branch came back, so a failed task doesn't leave `review`
				const status = workers.readStatus(task, tag ?? this.activeTag());
				const back = await workers.bringBack(
					task,
					base,
					createdBranch,
					// Killed, so its uncommitted work was never committed: keep the clone
					aborted || !!timedOut
				);
				hasWork = back.hasWork;
				// The work is only in the clone: keep the claim so no other run starts over
				if (!back.fetched) releaseClaim = aborted;
				if (back.fetched && status) {
					await this.applyStatus(task.id, status, tag, claimant);
				}
			} else if (hasWorktree) {
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
			if (hasWorktree) await git.recordBranch(task.branch);
			if (releaseClaim || !hasWork) {
				await this.release(task.id, tag, claimant);
			}
			task.claimed = await this.isClaimed(task.id, tag, claimant);
			task.finished =
				task.state === 'done' && (await this.isFinished(task.id, tag));
		}
	}

	/**
	 * The status a container worker set on its own copy of tasks.json,
	 * applied here while the task is still this run's claim. Only the status
	 * comes back; notes and other changes the worker made stay in the copy.
	 */
	private async applyStatus(
		id: string,
		status: TaskStatus,
		tag: string | undefined,
		claimant: string
	): Promise<void> {
		if (!(await this.isClaimed(id, tag, claimant))) return;
		try {
			await this.tasks.updateStatus(id, status, tag);
		} catch (error) {
			this.logger.warn(`Couldn't set task ${id} to ${status}:`, error);
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

	/** In review or done (assumed not if unreadable) */
	private async isFinished(
		id: string,
		tag: string | undefined
	): Promise<boolean> {
		try {
			return isFinishedStatus((await this.tasks.get(id, tag)).task?.status);
		} catch {
			return false;
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
