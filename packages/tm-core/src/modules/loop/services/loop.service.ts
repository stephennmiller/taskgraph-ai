/**
 * @fileoverview Loop Service - Orchestrates running Claude Code iterations (sandbox or CLI mode)
 */

import { getLogger } from '../../../common/logger/index.js';
import type { TaskStatus } from '../../../common/types/index.js';
import { isTaskPreset } from '../loop-task.js';
import { TRUST_LOST, isLoopTrusted, keepLoopTrust } from '../loop-trust.js';
import {
	type ModelChoice,
	modelArgs,
	pickModelEffort
} from '../model-bands.js';
import {
	DEFAULT_RESUME_MAX_CONTEXT_TOKENS,
	resumableSession
} from '../session-resume.js';
import { allComplete, statusProgress } from '../task-progress.js';
import type { LoopServiceOptions } from './loop-service-options.js';
import {
	checkSandboxAuth,
	runInteractiveAuth,
	stopSandbox
} from './docker-sandbox.js';
import { buildCommandArgs, spawnIteration } from './iteration-process.js';
import { interruptedTask } from './interrupted-task.js';
import { buildPrompt } from './loop-prompt.js';
import { StuckTasks, stalledMessage } from './stuck-tasks.js';
import { executeVerboseIteration } from './verbose-iteration.js';
import {
	completeIteration,
	createErrorIteration,
	formatCommandError,
	loopResult,
	type RunSpend,
	claudeRan,
	runSpend,
	withoutMarker
} from './iteration-result.js';
import {
	appendFinalSummary,
	appendIterationLine,
	initProgressFile
} from './progress-file.js';
import {
	findResultEvent,
	hasStreamEvent,
	withoutEvents
} from './stream-events.js';
import {
	budgetSpent,
	capArgs,
	MAX_CONSECUTIVE_ERRORS,
	MAX_STALLED_ITERATIONS,
	loopIterationTimeoutMs,
	silenceMessage
} from './iteration-limits.js';
import type {
	LoopConfig,
	LoopIteration,
	LoopOutputCallbacks,
	LoopResult
} from '../types.js';

export type { LoopServiceOptions } from './loop-service-options.js';

export class LoopService {
	private readonly projectRoot: string;
	private readonly findReadyTask?: (
		tag?: string
	) => Promise<string | undefined>;
	private readonly taskStatuses?: LoopServiceOptions['taskStatuses'];
	private readonly headCommit?: LoopServiceOptions['headCommit'];
	private readonly taskComplexity?: LoopServiceOptions['taskComplexity'];
	private readonly blockTask?: LoopServiceOptions['blockTask'];
	private readonly recordSpend?: LoopServiceOptions['recordSpend'];
	private stuck?: StuckTasks;
	private readonly uncommittedFiles?: LoopServiceOptions['uncommittedFiles'];
	private readonly logger = getLogger('LoopService');
	private _isRunning = false;
	/** Approved via the trust file; re-stamped each iteration */
	private approved = false;

	constructor(options: LoopServiceOptions) {
		this.projectRoot = options.projectRoot;
		this.findReadyTask = options.findReadyTask;
		this.taskStatuses = options.taskStatuses;
		this.headCommit = options.headCommit;
		this.taskComplexity = options.taskComplexity;
		this.blockTask = options.blockTask;
		this.recordSpend = options.recordSpend;
		this.uncommittedFiles = options.uncommittedFiles;
	}

	getProjectRoot(): string {
		return this.projectRoot;
	}

	get isRunning(): boolean {
		return this._isRunning;
	}

	/** Check if Docker sandbox auth is ready */
	checkSandboxAuth(): { ready: boolean; error?: string } {
		return checkSandboxAuth(this.projectRoot);
	}

	/** Run interactive Docker sandbox session for user authentication */
	runInteractiveAuth(): { success: boolean; error?: string } {
		return runInteractiveAuth(this.projectRoot);
	}

	/** Run a loop with the given configuration */
	async run(config: LoopConfig): Promise<LoopResult> {
		// Validate incompatible options early - fail once, not per iteration
		if (config.verbose && config.sandbox) {
			const errorMsg =
				'Verbose mode is not supported with sandbox mode. Use --verbose without --sandbox, or remove --verbose.';
			this.reportError(config.callbacks, errorMsg);
			return {
				iterations: [],
				totalIterations: 0,
				tasksCompleted: 0,
				finalStatus: 'error',
				errorMessage: errorMsg
			};
		}

		this._isRunning = true;
		this.stuck = new StuckTasks(
			this.blockTask,
			() => this.readyTask(config),
			(m) => this.reportError(config.callbacks, m, 'warning'),
			config.tag
		);
		const iterations: LoopIteration[] = [];
		let tasksCompleted = 0;
		let consecutiveErrors = 0;
		let stalled = 0;
		let spent = 0;
		// The iteration whose session the next one may resume
		let resumeFrom: LoopIteration | undefined;
		// Only a run that works on tasks can be stuck on one
		const watchesTasks = !!config.taskId || isTaskPreset(config.prompt);

		await initProgressFile(this.projectRoot, config);
		let statuses = await this.readStatuses(config);
		// Nothing left for a task preset to work on: don't pay for an iteration to find that out
		if (
			!config.taskId &&
			isTaskPreset(config.prompt) &&
			allComplete(statuses)
		) {
			return this.finalize(config, iterations, 0, 'all_complete');
		}
		let head = await this.readHead();
		this.approved = !config.sandbox && isLoopTrusted(this.projectRoot);

		for (let i = 1; i <= config.iterations && this._isRunning; i++) {
			if (this.approved && !keepLoopTrust(this.projectRoot)) {
				const msg = TRUST_LOST;
				this.reportError(config.callbacks, msg);
				return this.finalize(config, iterations, tasksCompleted, 'error', msg);
			}
			// The run's budget: each iteration gets what's left
			const left =
				config.maxBudgetUsd === undefined
					? undefined
					: config.maxBudgetUsd - spent;
			if (left !== undefined && budgetSpent(left, config.maxBudgetUsd ?? 0)) {
				return this.finalize(
					config,
					iterations,
					tasksCompleted,
					'budget_reached'
				);
			}
			config.callbacks?.onIterationStart?.(i, config.iterations);

			// The task the iteration starts on, looked up once and only if needed
			let lookup: Promise<string | undefined> | undefined;
			const startTask = () =>
				(lookup ??= this.readyTask(config).then((id) => config.taskId ?? id));
			// Its spend goes on it; read before Claude moves on to another
			const spendOn = this.recordSpend ? await startTask() : undefined;
			const choice = await this.chooseModel(config, startTask);
			// Opt-in (#841); a sandbox keeps its sessions in the container, not here
			let resume =
				config.reuseSession && !config.sandbox
					? resumableSession(
							resumeFrom,
							choice,
							config.resumeMaxContextTokens ?? DEFAULT_RESUME_MAX_CONTEXT_TOKENS
						)
					: undefined;
			const interrupted = await interruptedTask(
				config.taskId,
				startTask,
				statuses,
				this.uncommittedFiles,
				config.sandbox
			);
			const run = async () =>
				this.executeIteration(
					await buildPrompt(config, i, !!resume, interrupted),
					i,
					config.sandbox ?? false,
					config.verbose ?? false,
					[
						...capArgs({ maxTurns: config.maxTurns, maxBudgetUsd: left }),
						...modelArgs(choice),
						...(resume ? ['--resume', resume] : [])
					],
					config.callbacks
				);
			let iteration = await run();
			// The session couldn't be resumed (gone, or never written): don't spend an iteration on it
			if (resume && iteration.status === 'error' && iteration.turns === 0) {
				resume = undefined;
				iteration = await run();
			}
			Object.assign(iteration, choice);
			if (config.reuseSession) iteration.session = resume ? 'resumed' : 'fresh';
			// Reported no cost: count all it was given (#855)
			if (iteration.costUnknown && left !== undefined) iteration.costUsd = left;
			iterations.push(iteration);
			spent += iteration.costUsd ?? 0;
			// Claude Code ran: what it spent goes on the task
			if (spendOn && claudeRan(iteration)) {
				await this.addSpend(config, spendOn, iteration);
			}

			// Completed means its status moved to done or review, not that Claude exited 0
			const after = await this.readStatuses(config);
			const progress =
				statuses && after
					? statusProgress(statuses, after)
					: { finished: 0, changed: true };
			const statusesMoved = !!statuses && !!after && progress.changed;
			statuses = after;
			tasksCompleted += progress.finished;
			// A task can take several iterations; a new commit is work on it
			const headAfter = await this.readHead();
			const committed = !!headAfter && headAfter !== head;
			head = headAfter;
			// Resume only a session that got somewhere
			resumeFrom = progress.changed || committed ? iteration : undefined;

			// Claude can say all tasks are done while one is still ready; keep going then
			if (iteration.status === 'complete') {
				const ready = await this.readyTask(config);
				if (ready) {
					iteration.status = 'success';
					iteration.message = `Claude said all tasks are done, but task ${ready} is ready`;
					// That session believes the work is done
					resumeFrom = undefined;
					this.reportError(
						config.callbacks,
						`${iteration.message}. Continuing.`,
						'warning'
					);
				}
			}

			config.callbacks?.onIterationEnd?.(iteration);
			await appendIterationLine(
				this.projectRoot,
				config.progressFile,
				iteration
			);

			// Check for early exit conditions
			if (iteration.status === 'complete') {
				return this.finalize(
					config,
					iterations,
					tasksCompleted,
					'all_complete'
				);
			}
			if (iteration.status === 'blocked') {
				// A task waiting on unfinished work doesn't block the rest (#938):
				// once Claude has rewired the tasks, keep going while one is ready
				const ready =
					progress.changed || committed
						? await this.readyTask(config)
						: undefined;
				if (!ready) {
					return this.finalize(config, iterations, tasksCompleted, 'blocked');
				}
				this.reportError(
					config.callbacks,
					`Blocked: ${iteration.message}. Task ${ready} is ready, so continuing.`,
					'warning'
				);
			}
			// A session that timed out or crashed after finishing work isn't a broken setup
			consecutiveErrors =
				iteration.status === 'error' && !statusesMoved && !committed
					? consecutiveErrors + 1
					: 0;
			const erroring = consecutiveErrors >= MAX_CONSECUTIVE_ERRORS;
			const broken =
				iteration.status === 'error' &&
				this.stuck.brokenSetup(iteration.message, erroring);
			if (progress.changed || committed) stalled = 0;
			else if (iteration.status === 'success') stalled++;
			const stalling = watchesTasks && stalled >= MAX_STALLED_ITERATIONS;
			// Work around a stuck task while another one is ready (#997)
			const { aside, ready } =
				!broken && (erroring || stalling)
					? await this.stuck.setAside(
							consecutiveErrors,
							stalled,
							erroring ? iteration.message : undefined
						)
					: {};
			if (ready) {
				// Its new status isn't progress on the next task
				statuses = await this.readStatuses(config);
				consecutiveErrors = 0;
				stalled = 0;
				resumeFrom = undefined;
			}
			if (!ready && (broken || erroring)) {
				return this.finalize(
					config,
					iterations,
					tasksCompleted,
					'error',
					iteration.message
				);
			}
			if (!ready && stalling) {
				const stuck = config.taskId ?? aside ?? (await this.readyTask(config));
				const msg = stalledMessage(stuck, stalled);
				this.reportError(config.callbacks, msg);
				return this.finalize(config, iterations, tasksCompleted, 'error', msg);
			}

			// Sleep between iterations (except last)
			if (i < config.iterations && config.sleepSeconds > 0) {
				await new Promise((r) => setTimeout(r, config.sleepSeconds * 1000));
			}
		}

		return this.finalize(config, iterations, tasksCompleted, 'max_iterations');
	}

	/** Stop the loop after current iteration completes */
	stop(): void {
		this._isRunning = false;
	}

	// ========== Private Helpers ==========

	/**
	 * The task `taskgraph next` would pick, for a task preset run over the
	 * whole tag. Undefined when the run is pinned to one task, the prompt
	 * picks its own work, or no lookup was given.
	 */
	private async readyTask(config: LoopConfig): Promise<string | undefined> {
		if (!this.findReadyTask || config.taskId || !isTaskPreset(config.prompt)) {
			return undefined;
		}
		try {
			return await this.findReadyTask(config.tag);
		} catch (error) {
			// An unreadable tasks file shouldn't crash the run; trust the marker
			this.reportError(
				config.callbacks,
				`Couldn't check for a ready task: ${error instanceof Error ? error.message : String(error)}`,
				'warning'
			);
			return undefined;
		}
	}

	/** The model and effort for the task this iteration starts on, from its complexity score */
	private async chooseModel(
		config: LoopConfig,
		startTask: () => Promise<string | undefined>
	): Promise<ModelChoice & { complexity?: number }> {
		// No lookup or no bands: skip the extra `taskgraph next`
		if (!this.taskComplexity || !config.bands?.length) {
			return pickModelEffort(undefined, [], config.model);
		}
		const id = await startTask();
		const score = id
			? await this.taskComplexity(id, config.tag).catch(() => undefined)
			: undefined;
		const choice = pickModelEffort(score, config.bands, config.model);
		return typeof score === 'number'
			? { ...choice, complexity: score }
			: choice;
	}

	/** Add the iteration's cost and time to the task; a failed write only warns */
	private async addSpend(
		config: LoopConfig,
		taskId: string,
		iteration: LoopIteration
	): Promise<void> {
		try {
			await this.recordSpend?.(
				taskId,
				{ usd: iteration.costUsd, durationMs: iteration.duration },
				config.tag
			);
		} catch (error) {
			this.reportError(
				config.callbacks,
				`Couldn't add the iteration's spend to task ${taskId}: ${error instanceof Error ? error.message : String(error)}`,
				'warning'
			);
		}
	}

	/** HEAD's commit, or null when there's no lookup or it fails */
	private readHead(): Promise<string | null> {
		return this.headCommit?.().catch(() => null) ?? Promise.resolve(null);
	}

	/** The tag's task statuses, or undefined when there's no lookup or the file can't be read */
	private async readStatuses(
		config: LoopConfig
	): Promise<Map<string, TaskStatus> | undefined> {
		try {
			return await this.taskStatuses?.(config.tag);
		} catch (error) {
			this.reportError(
				config.callbacks,
				`Couldn't read task statuses: ${error instanceof Error ? error.message : String(error)}`,
				'warning'
			);
			return undefined;
		}
	}

	private async finalize(
		config: LoopConfig,
		iterations: LoopIteration[],
		tasksCompleted: number,
		finalStatus: LoopResult['finalStatus'],
		errorMessage?: string
	): Promise<LoopResult> {
		this._isRunning = false;
		if (this.approved) keepLoopTrust(this.projectRoot);
		const result = loopResult(
			iterations,
			tasksCompleted,
			finalStatus,
			errorMessage
		);
		const setAside = this.stuck?.tasks;
		if (setAside) result.setAside = setAside;
		await appendFinalSummary(this.projectRoot, config.progressFile, result);
		return result;
	}

	/**
	 * Report an error via callback if provided, otherwise log to the logger.
	 * Ensures errors are never silently swallowed when callbacks aren't configured.
	 */
	private reportError(
		callbacks: LoopOutputCallbacks | undefined,
		message: string,
		severity: 'warning' | 'error' = 'error'
	): void {
		if (callbacks?.onError) {
			callbacks.onError(message, severity);
		} else if (severity === 'warning') {
			this.logger.warn(message);
		} else {
			this.logger.error(message);
		}
	}

	private async executeIteration(
		prompt: string,
		iterationNum: number,
		sandbox: boolean,
		verbose: boolean,
		extra: string[],
		callbacks?: LoopOutputCallbacks
	): Promise<LoopIteration> {
		const startTime = Date.now();
		const command = sandbox ? 'docker' : 'claude';
		const args = buildCommandArgs(this.projectRoot, prompt, sandbox, extra);

		if (verbose) {
			return executeVerboseIteration(
				this.projectRoot,
				(message, severity) => this.reportError(callbacks, message, severity),
				args,
				iterationNum,
				command,
				sandbox,
				startTime,
				callbacks
			);
		}

		const timeout = loopIterationTimeoutMs();
		return new Promise((resolve) => {
			let settled = false;
			let timedOut = false;
			let stdout = '';
			let stderr = '';
			const fail = (errorMessage: string, spent?: RunSpend): void => {
				this.reportError(callbacks, errorMessage);
				resolve(
					createErrorIteration(iterationNum, startTime, errorMessage, spent)
				);
			};
			const child = spawnIteration(
				command,
				args,
				this.projectRoot,
				timeout,
				() => {
					timedOut = true;
				},
				sandbox ? () => stopSandbox(this.projectRoot) : undefined
			);
			child.stdout?.setEncoding('utf-8').on('data', (d: string) => {
				stdout += d;
			});
			child.stderr?.setEncoding('utf-8').on('data', (d: string) => {
				stderr += d;
			});

			child.once('error', (error: NodeJS.ErrnoException) => {
				if (settled) return;
				settled = true;
				fail(formatCommandError(error, command, sandbox));
			});

			child.once('close', (exitCode: number | null) => {
				if (settled) return;
				settled = true;
				// No result event (an older Claude Code, or one that died): what
				// isn't an event is the reply
				const run = findResultEvent(stdout);
				if (timedOut) return fail(silenceMessage(timeout), runSpend(run));

				const reply = run ? run.text : withoutEvents(stdout);
				const output = withoutMarker(reply) + stderr;
				if (output) {
					callbacks?.onOutput?.(output);
				}

				if (exitCode === null) {
					return fail(
						'Command terminated abnormally (no exit code)',
						runSpend(run)
					);
				}

				// Markers come from Claude's reply on stdout; stderr would hide the last line
				resolve(
					completeIteration(
						iterationNum,
						startTime,
						reply,
						exitCode,
						run,
						hasStreamEvent(stdout)
					)
				);
			});
		});
	}
}
