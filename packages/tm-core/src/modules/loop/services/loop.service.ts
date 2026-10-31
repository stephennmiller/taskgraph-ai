/**
 * @fileoverview Loop Service - Orchestrates running Claude Code iterations (sandbox or CLI mode)
 */

import { readFile } from 'node:fs/promises';
import { getLogger } from '../../../common/logger/index.js';
import type { TaskStatus } from '../../../common/types/index.js';
import { TASK_DATA_RULE } from '../../../common/utils/prompt-tag.js';
import { isTaskPreset } from '../loop-task.js';
import { isLoopTrusted, keepLoopTrust } from '../loop-trust.js';
import { PRESETS, isPreset as checkIsPreset } from '../presets/index.js';
import { statusProgress } from '../task-progress.js';
import {
	checkSandboxAuth,
	runInteractiveAuth,
	sandboxRunArgs,
	stopSandbox
} from './docker-sandbox.js';
import { spawnIteration } from './iteration-process.js';
import { appendFinalSummary, initProgressFile } from './progress-file.js';
import {
	handleStreamEvent,
	isValidStreamEvent,
	processBufferedLines
} from './stream-events.js';
import {
	CLAUDE_MISSING,
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
}

/** A marker counts only alone on the last non-empty line, so quoting it in a sentence doesn't stop the loop */
const SIGNAL_LINE = /^<loop-(complete|blocked)>([^<]*)<\/loop-\1>$/i;

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
	private readonly logger = getLogger('LoopService');
	private _isRunning = false;
	/** Approved through the trust file, which parse-prd or github import can withdraw mid-run */
	private approved = false;

	constructor(options: LoopServiceOptions) {
		this.projectRoot = options.projectRoot;
		this.findReadyTask = options.findReadyTask;
		this.taskStatuses = options.taskStatuses;
		this.headCommit = options.headCommit;
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
		// Only a run that works on tasks can be stuck on one
		const watchesTasks = !!config.taskId || isTaskPreset(config.prompt);

		await initProgressFile(config);
		let statuses = await this.readStatuses(config);
		let head = await this.readHead();
		this.approved = !config.sandbox && isLoopTrusted(this.projectRoot);

		for (let i = 1; i <= config.iterations && this._isRunning; i++) {
			if (this.approved && !keepLoopTrust(this.projectRoot)) {
				const msg =
					'Approval for this project was withdrawn during the run: parse-prd, github import or research added to the tasks. Run loop again to approve the tasks as they are now.';
				this.reportError(config.callbacks, msg);
				return this.finalize(config, iterations, tasksCompleted, 'error', msg);
			}
			// Notify presentation layer of iteration start
			config.callbacks?.onIterationStart?.(i, config.iterations);

			const prompt = await this.buildPrompt(config, i);
			const iteration = await this.executeIteration(
				prompt,
				i,
				config.sandbox ?? false,
				config.verbose ?? false,
				config.callbacks
			);
			iterations.push(iteration);

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
		// The run's own task changes (notes, statuses, new subtasks) stay approved for the next run
		if (this.approved) keepLoopTrust(this.projectRoot);
		const result: LoopResult = {
			iterations,
			totalIterations: iterations.length,
			tasksCompleted,
			finalStatus,
			...(errorMessage ? { errorMessage } : {})
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

	private parseCompletion(
		output: string,
		exitCode: number
	): { status: LoopIteration['status']; message?: string } {
		const lastLine = output.trimEnd().split('\n').pop()?.trim() ?? '';
		const signal = lastLine.match(SIGNAL_LINE);
		if (signal) {
			const status =
				signal[1].toLowerCase() === 'complete' ? 'complete' : 'blocked';
			return { status, message: signal[2].trim() };
		}

		if (exitCode !== 0)
			return { status: 'error', message: `Exit code ${exitCode}` };
		return { status: 'success' };
	}

	private async executeIteration(
		prompt: string,
		iterationNum: number,
		sandbox: boolean,
		verbose = false,
		callbacks?: LoopOutputCallbacks
	): Promise<LoopIteration> {
		const startTime = Date.now();
		const command = sandbox ? 'docker' : 'claude';

		if (verbose) {
			return this.executeVerboseIteration(
				prompt,
				iterationNum,
				command,
				sandbox,
				startTime,
				callbacks
			);
		}

		const args = this.buildCommandArgs(prompt, sandbox, false);
		const timeout = loopIterationTimeoutMs();
		return new Promise((resolve) => {
			let settled = false;
			let timedOut = false;
			let stdout = '';
			let stderr = '';
			const fail = (errorMessage: string): void => {
				this.reportError(callbacks, errorMessage);
				resolve(
					this.createErrorIteration(iterationNum, startTime, errorMessage)
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
				fail(this.formatCommandError(error, command, sandbox));
			});

			child.once('close', (exitCode: number | null) => {
				if (settled) return;
				settled = true;
				if (timedOut) return fail(timeoutMessage(timeout));

				const output = stdout + stderr;
				if (output) {
					callbacks?.onOutput?.(output);
				}

				if (exitCode === null) {
					return fail('Command terminated abnormally (no exit code)');
				}

				// Markers come from Claude's reply on stdout; stderr would hide the last line
				const { status, message } = this.parseCompletion(stdout, exitCode);
				resolve({
					iteration: iterationNum,
					status,
					duration: Date.now() - startTime,
					message
				});
			});
		});
	}

	/**
	 * Execute an iteration with verbose output (shows Claude's work in real-time).
	 * Uses Claude's stream-json format to display assistant messages as they arrive.
	 * @param prompt - The prompt to send to Claude
	 * @param iterationNum - Current iteration number (1-indexed)
	 * @param command - The command to execute ('claude' or 'docker')
	 * @param sandbox - Whether running in Docker sandbox mode
	 * @param startTime - Timestamp when iteration started (for duration calculation)
	 * @param callbacks - Optional callbacks for presentation layer output
	 * @returns Promise resolving to the iteration result
	 */
	private executeVerboseIteration(
		prompt: string,
		iterationNum: number,
		command: string,
		sandbox: boolean,
		startTime: number,
		callbacks?: LoopOutputCallbacks
	): Promise<LoopIteration> {
		const args = this.buildCommandArgs(prompt, sandbox, true);

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
			let finalResult = '';
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

					// Final result text, checked for completion markers
					if (event.type === 'result') {
						finalResult = typeof event.result === 'string' ? event.result : '';
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
					this.createErrorIteration(
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
				const errorMessage = this.formatCommandError(error, command, sandbox);
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
					this.createErrorIteration(iterationNum, startTime, errorMessage)
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
					resolveOnce(
						this.createErrorIteration(iterationNum, startTime, errorMsg)
					);
					return;
				}

				const { status, message } = this.parseCompletion(finalResult, exitCode);
				resolveOnce({
					iteration: iterationNum,
					status,
					duration: Date.now() - startTime,
					message
				});
			});
		});
	}

	private buildCommandArgs(
		prompt: string,
		sandbox: boolean,
		verbose: boolean
	): string[] {
		if (sandbox) {
			return sandboxRunArgs(this.projectRoot, '-p', prompt);
		}

		const args = ['-p', prompt, '--dangerously-skip-permissions'];
		if (verbose) {
			// Use stream-json format to show Claude's work in real-time
			args.push('--output-format', 'stream-json', '--verbose');
		}
		return args;
	}

	private formatCommandError(
		error: NodeJS.ErrnoException,
		command: string,
		sandbox: boolean
	): string {
		if (error.code === 'ENOENT') {
			return sandbox ? DOCKER_MISSING : CLAUDE_MISSING;
		}

		if (error.code === 'EACCES') {
			return `Permission denied executing '${command}'`;
		}

		return `Failed to execute '${command}': ${error.message}`;
	}

	private createErrorIteration(
		iterationNum: number,
		startTime: number,
		message: string
	): LoopIteration {
		return {
			iteration: iterationNum,
			status: 'error',
			duration: Date.now() - startTime,
			message
		};
	}
}
