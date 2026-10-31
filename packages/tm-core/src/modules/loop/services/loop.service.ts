/**
 * @fileoverview Loop Service - Orchestrates running Claude Code iterations (sandbox or CLI mode)
 */

import { readFile } from 'node:fs/promises';
import { getLogger } from '../../../common/logger/index.js';
import type { TaskStatus } from '../../../common/types/index.js';
import { TASK_DATA_RULE } from '../../../common/utils/prompt-tag.js';
import { isTaskPreset } from '../loop-task.js';
import { isLoopTrusted } from '../loop-trust.js';
import {
	type ModelChoice,
	modelArgs,
	pickModelEffort
} from '../model-bands.js';
import { PRESETS, isPreset as checkIsPreset } from '../presets/index.js';
import { statusProgress } from '../task-progress.js';
import {
	checkSandboxAuth,
	runInteractiveAuth,
	stopSandbox
} from './docker-sandbox.js';
import { buildCommandArgs, spawnIteration } from './iteration-process.js';
import {
	completeIteration,
	createErrorIteration,
	formatCommandError
} from './iteration-result.js';
import {
	appendFinalSummary,
	appendIterationLine,
	initProgressFile
} from './progress-file.js';
import {
	type ClaudeRunResult,
	findResultEvent,
	handleStreamEvent,
	isValidStreamEvent,
	processBufferedLines,
	readResultEvent,
	withoutEvents
} from './stream-events.js';
import {
	CLAUDE_MISSING,
	capArgs,
	DOCKER_MISSING,
	MAX_CONSECUTIVE_ERRORS,
	MAX_STALLED_ITERATIONS,
	loopIterationTimeoutMs,
	timeoutMessage
} from './iteration-limits.js';
import type {
	LoopConfig,
	LoopIteration,
	LoopOutputCallbacks,
	LoopPreset,
	LoopResult
} from '../types.js';

export interface LoopServiceOptions {
	projectRoot: string;
	/** The task `taskgraph next` would pick in a tag, checked before a run ends as all_complete */
	findReadyTask?: (tag?: string) => Promise<string | undefined>;
	/** Each task's and subtask's status in a tag, compared around every iteration */
	taskStatuses?: (tag?: string) => Promise<Map<string, TaskStatus>>;
	/** The commit HEAD points at (null if none), so a commit counts as progress on a task that takes several iterations */
	headCommit?: () => Promise<string | null>;
	/** A task's complexity score, which picks the iteration's model and effort */
	taskComplexity?: (id: string, tag?: string) => Promise<unknown>;
}

/** Appended to every prompt, presets and custom files alike */
const SIGNAL_RULE =
	'To stop the loop, end your reply with the <loop-complete> or <loop-blocked> marker alone on the last line. A marker anywhere else is ignored.';

export class LoopService {
	private readonly projectRoot: string;
	private readonly findReadyTask?: (
		tag?: string
	) => Promise<string | undefined>;
	private readonly taskStatuses?: LoopServiceOptions['taskStatuses'];
	private readonly headCommit?: LoopServiceOptions['headCommit'];
	private readonly taskComplexity?: LoopServiceOptions['taskComplexity'];
	private readonly logger = getLogger('LoopService');
	private _isRunning = false;

	constructor(options: LoopServiceOptions) {
		this.projectRoot = options.projectRoot;
		this.findReadyTask = options.findReadyTask;
		this.taskStatuses = options.taskStatuses;
		this.headCommit = options.headCommit;
		this.taskComplexity = options.taskComplexity;
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
		const iterations: LoopIteration[] = [];
		let tasksCompleted = 0;
		let consecutiveErrors = 0;
		let stalled = 0;
		let spent = 0;
		// Only a run that works on tasks can be stuck on one
		const watchesTasks = !!config.taskId || isTaskPreset(config.prompt);

		await initProgressFile(config);
		let statuses = await this.readStatuses(config);
		let head = await this.readHead();
		// Approved through the trust file: parse-prd or github import can withdraw it mid-run
		const approved = !config.sandbox && isLoopTrusted(this.projectRoot);

		for (let i = 1; i <= config.iterations && this._isRunning; i++) {
			if (approved && !isLoopTrusted(this.projectRoot)) {
				const msg =
					'Tasks were added since loop was approved. Run loop again to approve them.';
				this.reportError(config.callbacks, msg);
				return this.finalize(config, iterations, tasksCompleted, 'error', msg);
			}
			// The run's budget: each iteration gets what's left
			const left =
				config.maxBudgetUsd === undefined
					? undefined
					: config.maxBudgetUsd - spent;
			if (left !== undefined && left < 0.0001) {
				return this.finalize(
					config,
					iterations,
					tasksCompleted,
					'budget_reached'
				);
			}
			// Notify presentation layer of iteration start
			config.callbacks?.onIterationStart?.(i, config.iterations);

			const prompt = await this.buildPrompt(config, i);
			const choice = await this.chooseModel(config);
			const iteration = await this.executeIteration(
				prompt,
				i,
				config.sandbox ?? false,
				config.verbose ?? false,
				[
					...capArgs({ maxTurns: config.maxTurns, maxBudgetUsd: left }),
					...modelArgs(choice)
				],
				config.callbacks
			);
			Object.assign(iteration, choice);
			iterations.push(iteration);
			spent += iteration.costUsd ?? 0;

			// Completed means its status moved to done or review, not that Claude exited 0
			const after = await this.readStatuses(config);
			const progress =
				statuses && after
					? statusProgress(statuses, after)
					: { finished: 0, changed: true };
			statuses = after;
			tasksCompleted += progress.finished;
			// A task can take several iterations; a new commit is work on it
			const headAfter = await this.readHead();
			const committed = !!headAfter && headAfter !== head;
			head = headAfter;

			// Claude can say all tasks are done while one is still ready; keep going then
			if (iteration.status === 'complete') {
				const ready = await this.readyTask(config);
				if (ready) {
					iteration.status = 'success';
					iteration.message = `Claude said all tasks are done, but task ${ready} is ready`;
					this.reportError(
						config.callbacks,
						`${iteration.message}. Continuing.`,
						'warning'
					);
				}
			}

			// Notify presentation layer of iteration completion
			config.callbacks?.onIterationEnd?.(iteration);
			await appendIterationLine(config.progressFile, iteration);

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
				return this.finalize(config, iterations, tasksCompleted, 'blocked');
			}
			consecutiveErrors =
				iteration.status === 'error' ? consecutiveErrors + 1 : 0;
			const missing =
				iteration.message === CLAUDE_MISSING ||
				iteration.message === DOCKER_MISSING;
			if (missing || consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
				return this.finalize(
					config,
					iterations,
					tasksCompleted,
					'error',
					iteration.message
				);
			}
			if (progress.changed || committed) stalled = 0;
			else if (iteration.status === 'success') stalled++;
			if (watchesTasks && stalled >= MAX_STALLED_ITERATIONS) {
				const stuck = config.taskId ?? (await this.readyTask(config));
				const msg = `${stuck ? `Task ${stuck} is stuck: no` : 'No'} task changed status and nothing was committed in ${stalled} iterations in a row. Check the progress file and the task, then run loop again.`;
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
		config: LoopConfig
	): Promise<ModelChoice & { complexity?: number }> {
		// No lookup or no bands: skip the extra `taskgraph next`
		if (!this.taskComplexity || !config.bands?.length) {
			return pickModelEffort(undefined, [], config.model);
		}
		const id = config.taskId ?? (await this.readyTask(config));
		const score = id
			? await this.taskComplexity?.(id, config.tag).catch(() => undefined)
			: undefined;
		const choice = pickModelEffort(score, config.bands ?? [], config.model);
		return typeof score === 'number'
			? { ...choice, complexity: score }
			: choice;
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
		const sum = (key: 'costUsd' | 'turns') =>
			iterations.some((it) => it[key] !== undefined)
				? iterations.reduce((total, it) => total + (it[key] ?? 0), 0)
				: undefined;
		const totalCostUsd = sum('costUsd');
		const totalTurns = sum('turns');
		const result: LoopResult = {
			iterations,
			totalIterations: iterations.length,
			tasksCompleted,
			finalStatus,
			...(errorMessage ? { errorMessage } : {}),
			...(totalCostUsd !== undefined ? { totalCostUsd } : {}),
			...(totalTurns !== undefined ? { totalTurns } : {})
		};
		await appendFinalSummary(config.progressFile, result);
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

	private isPreset(name: string): name is LoopPreset {
		return checkIsPreset(name);
	}

	private async resolvePrompt(prompt: string): Promise<string> {
		if (this.isPreset(prompt)) {
			return PRESETS[prompt];
		}
		const content = await readFile(prompt, 'utf-8');
		if (!content.trim()) {
			throw new Error(`Custom prompt file '${prompt}' is empty`);
		}
		return content;
	}

	private buildContextHeader(config: LoopConfig, iteration: number): string {
		const tagInfo = config.tag ? ` (tag: ${config.tag})` : '';
		// The pinned task replaces the preset's `taskgraph next` step
		const taskInfo = config.taskId
			? `\n\nWork on task ${config.taskId} only. Use it in place of the task taskgraph next would pick, and read it with taskgraph show ${config.taskId}.`
			: '';
		return `@${config.progressFile} @CLAUDE.md

Loop iteration ${iteration} of ${config.iterations}${tagInfo}${taskInfo}`;
	}

	private async buildPrompt(
		config: LoopConfig,
		iteration: number
	): Promise<string> {
		const basePrompt = await this.resolvePrompt(config.prompt);
		return `${this.buildContextHeader(config, iteration)}\n\n${basePrompt}\n\n${TASK_DATA_RULE}\n\n${SIGNAL_RULE}`;
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
			return this.executeVerboseIteration(
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
			const fail = (errorMessage: string): void => {
				this.reportError(callbacks, errorMessage);
				resolve(createErrorIteration(iterationNum, startTime, errorMessage));
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
				if (timedOut) return fail(timeoutMessage(timeout));

				// No result event (an older Claude Code, or one that died): what
				// isn't an event is the reply
				const run = findResultEvent(stdout);
				const reply = run ? run.text : withoutEvents(stdout);
				const output = reply + stderr;
				if (output) {
					callbacks?.onOutput?.(output);
				}

				if (exitCode === null) {
					return fail('Command terminated abnormally (no exit code)');
				}

				// Markers come from Claude's reply on stdout; stderr would hide the last line
				resolve(
					completeIteration(iterationNum, startTime, reply, exitCode, run)
				);
			});
		});
	}

	/**
	 * Execute an iteration with verbose output (shows Claude's work in real-time).
	 * Uses Claude's stream-json format to display assistant messages as they
	 * arrive. `args` come from buildCommandArgs; `startTime` times the iteration.
	 */
	private executeVerboseIteration(
		args: string[],
		iterationNum: number,
		command: string,
		sandbox: boolean,
		startTime: number,
		callbacks?: LoopOutputCallbacks
	): Promise<LoopIteration> {
		return new Promise((resolve) => {
			// Prevent multiple resolutions from race conditions between error/close events
			let isResolved = false;
			const resolveOnce = (result: LoopIteration): void => {
				if (!isResolved) {
					isResolved = true;
					resolve(result);
				}
			};

			const timeout = loopIterationTimeoutMs();
			let timedOut = false;
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

			// Track stdout completion to handle race between data and close events
			let stdoutEnded = false;
			let run: ClaudeRunResult | undefined;
			let buffer = '';

			const processLine = (line: string): void => {
				if (!line.startsWith('{')) return;

				try {
					const event = JSON.parse(line);

					// Validate event structure before accessing properties
					if (!isValidStreamEvent(event)) {
						return;
					}

					handleStreamEvent(event, callbacks);

					// Final result: its text is checked for completion markers
					if (event.type === 'result') {
						run = readResultEvent(event as Record<string, unknown>);
					}
				} catch (error) {
					// Log malformed JSON for debugging (non-JSON lines like system output are expected)
					if (line.trim().startsWith('{')) {
						const parseError = `Failed to parse JSON event: ${error instanceof Error ? error.message : 'Unknown error'}. Line: ${line.substring(0, 100)}...`;
						this.reportError(callbacks, parseError, 'warning');
					}
				}
			};

			// Handle null stdout (shouldn't happen with pipe, but be defensive)
			if (!child.stdout) {
				resolveOnce(
					createErrorIteration(
						iterationNum,
						startTime,
						'Failed to capture stdout from child process'
					)
				);
				return;
			}

			// Decoded as a stream, so a character split across chunks stays whole
			child.stdout.setEncoding('utf-8').on('data', (data: string) => {
				try {
					const lines = processBufferedLines(buffer, data);
					buffer = lines.remaining;
					for (const line of lines.complete) {
						processLine(line);
					}
				} catch (error) {
					this.reportError(
						callbacks,
						`Failed to process stdout data: ${error instanceof Error ? error.message : 'Unknown error'}`,
						'warning'
					);
				}
			});

			child.stdout.on('end', () => {
				stdoutEnded = true;
				// Process any remaining buffer when stdout ends
				if (buffer) {
					processLine(buffer);
					buffer = '';
				}
			});

			child.stderr?.setEncoding('utf-8').on('data', (data: string) => {
				callbacks?.onStderr?.(iterationNum, data);
			});

			child.on('error', (error: NodeJS.ErrnoException) => {
				const errorMessage = formatCommandError(error, command, sandbox);
				this.reportError(callbacks, errorMessage);

				// Cleanup: remove listeners and kill process if still running
				child.stdout?.removeAllListeners();
				child.stderr?.removeAllListeners();
				if (!child.killed) {
					try {
						child.kill('SIGTERM');
					} catch {
						// Process may have already exited
					}
				}

				resolveOnce(
					createErrorIteration(iterationNum, startTime, errorMessage)
				);
			});

			child.on('close', (exitCode: number | null) => {
				// Process remaining buffer only if stdout hasn't already ended
				if (!stdoutEnded && buffer) {
					processLine(buffer);
				}

				if (timedOut || exitCode === null) {
					const errorMsg = timedOut
						? timeoutMessage(timeout)
						: 'Command terminated abnormally (no exit code)';
					this.reportError(callbacks, errorMsg);
					resolveOnce(createErrorIteration(iterationNum, startTime, errorMsg));
					return;
				}

				resolveOnce(
					completeIteration(
						iterationNum,
						startTime,
						run?.text ?? '',
						exitCode,
						run
					)
				);
			});
		});
	}
}
