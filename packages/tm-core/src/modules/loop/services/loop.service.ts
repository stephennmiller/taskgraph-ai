/**
 * @fileoverview Loop Service - Orchestrates running Claude Code iterations (sandbox or CLI mode)
 */

import { spawn, spawnSync } from 'node:child_process';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { getLogger } from '../../../common/logger/index.js';
import { isTaskPreset } from '../loop-task.js';
import { PRESETS, isPreset as checkIsPreset } from '../presets/index.js';
import {
	CLAUDE_MISSING,
	DOCKER_MISSING,
	MAX_CONSECUTIVE_ERRORS,
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
	private readonly logger = getLogger('LoopService');
	private _isRunning = false;

	constructor(options: LoopServiceOptions) {
		this.projectRoot = options.projectRoot;
		this.findReadyTask = options.findReadyTask;
	}

	getProjectRoot(): string {
		return this.projectRoot;
	}

	get isRunning(): boolean {
		return this._isRunning;
	}

	/** Check if Docker sandbox auth is ready */
	checkSandboxAuth(): { ready: boolean; error?: string } {
		const result = spawnSync(
			'docker',
			['sandbox', 'run', 'claude', '-p', 'Say OK'],
			{
				cwd: this.projectRoot,
				timeout: 30000,
				encoding: 'utf-8',
				stdio: ['inherit', 'pipe', 'pipe']
			}
		);

		if (result.error) {
			const code = (result.error as NodeJS.ErrnoException).code;
			if (code === 'ENOENT') {
				return {
					ready: false,
					error: DOCKER_MISSING
				};
			}
			return { ready: false, error: `Docker error: ${result.error.message}` };
		}

		const output = (result.stdout || '') + (result.stderr || '');
		return { ready: output.toLowerCase().includes('ok') };
	}

	/** Run interactive Docker sandbox session for user authentication */
	runInteractiveAuth(): { success: boolean; error?: string } {
		const result = spawnSync(
			'docker',
			[
				'sandbox',
				'run',
				'claude',
				"You're authenticated! Press Ctrl+C to continue."
			],
			{
				cwd: this.projectRoot,
				stdio: 'inherit'
			}
		);

		if (result.error) {
			const code = (result.error as NodeJS.ErrnoException).code;
			if (code === 'ENOENT') {
				return {
					success: false,
					error: DOCKER_MISSING
				};
			}
			return { success: false, error: `Docker error: ${result.error.message}` };
		}

		if (result.status === null) {
			return {
				success: false,
				error: 'Docker terminated abnormally (no exit code)'
			};
		}

		if (result.status !== 0) {
			return {
				success: false,
				error: `Docker exited with code ${result.status}`
			};
		}

		return { success: true };
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

		await this.initProgressFile(config);

		for (let i = 1; i <= config.iterations && this._isRunning; i++) {
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
					tasksCompleted + 1,
					'all_complete'
				);
			}
			if (iteration.status === 'blocked') {
				return this.finalize(config, iterations, tasksCompleted, 'blocked');
			}
			if (iteration.status === 'success') {
				tasksCompleted++;
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

	private async finalize(
		config: LoopConfig,
		iterations: LoopIteration[],
		tasksCompleted: number,
		finalStatus: LoopResult['finalStatus'],
		errorMessage?: string
	): Promise<LoopResult> {
		this._isRunning = false;
		const result: LoopResult = {
			iterations,
			totalIterations: iterations.length,
			tasksCompleted,
			finalStatus,
			...(errorMessage ? { errorMessage } : {})
		};
		await this.appendFinalSummary(config.progressFile, result);
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

	private async initProgressFile(config: LoopConfig): Promise<void> {
		await mkdir(path.dirname(config.progressFile), { recursive: true });
		const lines = [
			'# TaskGraph Loop Progress',
			`# Started: ${new Date().toISOString()}`,
			`# Preset: ${config.prompt}`,
			`# Max Iterations: ${config.iterations}`,
			...(config.tag ? [`# Tag: ${config.tag}`] : []),
			'',
			'---',
			''
		];
		// Append to existing progress file instead of overwriting
		await appendFile(
			config.progressFile,
			'\n' + lines.join('\n') + '\n',
			'utf-8'
		);
	}

	private async appendFinalSummary(
		file: string,
		result: LoopResult
	): Promise<void> {
		await appendFile(
			file,
			`
---
# Loop Complete: ${new Date().toISOString()}
- Total iterations: ${result.totalIterations}
- Tasks completed: ${result.tasksCompleted}
- Final status: ${result.finalStatus}
`,
			'utf-8'
		);
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
		// Note: tasks.json reference removed - let the preset control task source to avoid confusion
		return `@${config.progressFile} @CLAUDE.md

Loop iteration ${iteration} of ${config.iterations}${tagInfo}${taskInfo}`;
	}

	private async buildPrompt(
		config: LoopConfig,
		iteration: number
	): Promise<string> {
		const basePrompt = await this.resolvePrompt(config.prompt);
		return `${this.buildContextHeader(config, iteration)}\n\n${basePrompt}\n\n${SIGNAL_RULE}`;
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
		const result = spawnSync(command, args, {
			cwd: this.projectRoot,
			encoding: 'utf-8',
			maxBuffer: 50 * 1024 * 1024,
			stdio: ['inherit', 'pipe', 'pipe'],
			timeout
		});

		if (result.error) {
			const error = result.error as NodeJS.ErrnoException;
			const errorMessage =
				error.code === 'ETIMEDOUT'
					? timeoutMessage(timeout)
					: this.formatCommandError(error, command, sandbox);
			this.reportError(callbacks, errorMessage);
			return this.createErrorIteration(iterationNum, startTime, errorMessage);
		}

		const output = (result.stdout || '') + (result.stderr || '');
		if (output) {
			callbacks?.onOutput?.(output);
		}

		if (result.status === null) {
			const errorMsg = 'Command terminated abnormally (no exit code)';
			this.reportError(callbacks, errorMsg);
			return this.createErrorIteration(iterationNum, startTime, errorMsg);
		}

		// Markers come from Claude's reply on stdout; stderr would hide the last line
		const { status, message } = this.parseCompletion(
			result.stdout || '',
			result.status
		);
		return {
			iteration: iterationNum,
			status,
			duration: Date.now() - startTime,
			message
		};
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

			const child = spawn(command, args, {
				cwd: this.projectRoot,
				stdio: ['inherit', 'pipe', 'pipe']
			});
			const timeout = loopIterationTimeoutMs();
			let timedOut = false;
			const timer = setTimeout(() => {
				timedOut = true;
				child.kill('SIGTERM');
			}, timeout);

			// Track stdout completion to handle race between data and close events
			let stdoutEnded = false;
			let finalResult = '';
			let buffer = '';

			const processLine = (line: string): void => {
				if (!line.startsWith('{')) return;

				try {
					const event = JSON.parse(line);

					// Validate event structure before accessing properties
					if (!this.isValidStreamEvent(event)) {
						return;
					}

					this.handleStreamEvent(event, callbacks);

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

			child.stdout.on('data', (data: Buffer) => {
				try {
					const lines = this.processBufferedLines(
						buffer,
						data.toString('utf-8')
					);
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

			child.stderr?.on('data', (data: Buffer) => {
				const stderrText = data.toString('utf-8');
				callbacks?.onStderr?.(iterationNum, stderrText);
			});

			child.on('error', (error: NodeJS.ErrnoException) => {
				clearTimeout(timer);
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
				clearTimeout(timer);
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

	/**
	 * Validate that a parsed JSON object has the expected stream event structure.
	 */
	private isValidStreamEvent(event: unknown): event is {
		type: string;
		message?: {
			content?: Array<{ type: string; text?: string; name?: string }>;
		};
		result?: string;
	} {
		if (!event || typeof event !== 'object') {
			return false;
		}

		const e = event as Record<string, unknown>;
		if (!('type' in e) || typeof e.type !== 'string') {
			return false;
		}

		// Validate message structure if present
		if ('message' in e && e.message !== undefined) {
			if (typeof e.message !== 'object' || e.message === null) {
				return false;
			}
			const msg = e.message as Record<string, unknown>;
			if ('content' in msg && !Array.isArray(msg.content)) {
				return false;
			}
		}

		return true;
	}

	private buildCommandArgs(
		prompt: string,
		sandbox: boolean,
		verbose: boolean
	): string[] {
		if (sandbox) {
			return ['sandbox', 'run', 'claude', '-p', prompt];
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

	private handleStreamEvent(
		event: {
			type: string;
			message?: {
				content?: Array<{ type: string; text?: string; name?: string }>;
			};
		},
		callbacks?: LoopOutputCallbacks
	): void {
		if (event.type !== 'assistant' || !event.message?.content) return;

		for (const block of event.message.content) {
			if (block.type === 'text' && block.text) {
				callbacks?.onText?.(block.text);
			} else if (block.type === 'tool_use' && block.name) {
				callbacks?.onToolUse?.(block.name);
			}
		}
	}

	private processBufferedLines(
		buffer: string,
		newData: string
	): { complete: string[]; remaining: string } {
		const combined = buffer + newData;
		const lines = combined.split('\n');
		return {
			complete: lines.slice(0, -1),
			remaining: lines[lines.length - 1]
		};
	}
}
