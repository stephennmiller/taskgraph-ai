/**
 * @fileoverview A loop iteration run with --verbose: Claude's work shown as it streams
 */

import type { LoopIteration, LoopOutputCallbacks } from '../types.js';
import { stopSandbox } from './docker-sandbox.js';
import { spawnIteration } from './iteration-process.js';
import {
	completeIteration,
	createErrorIteration,
	formatCommandError,
	runSpend
} from './iteration-result.js';
import { loopIterationTimeoutMs, silenceMessage } from './iteration-limits.js';
import {
	type ClaudeRunResult,
	contextTokens,
	handleStreamEvent,
	isValidStreamEvent,
	processBufferedLines,
	readResultEvent
} from './stream-events.js';

/**
 * Execute an iteration with verbose output (shows Claude's work in real-time).
 * Uses Claude's stream-json format to display assistant messages as they
 * arrive. `args` come from buildCommandArgs; `startTime` times the iteration.
 */
export function executeVerboseIteration(
	projectRoot: string,
	report: (message: string, severity?: 'warning' | 'error') => void,
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
			projectRoot,
			timeout,
			() => {
				timedOut = true;
			},
			sandbox ? () => stopSandbox(projectRoot) : undefined
		);

		// Track stdout completion to handle race between data and close events
		let stdoutEnded = false;
		let started = false;
		let run: ClaudeRunResult | undefined;
		let context: number | undefined;
		let buffer = '';

		const processLine = (line: string): void => {
			if (!line.startsWith('{')) return;

			try {
				const event = JSON.parse(line);

				if (!isValidStreamEvent(event)) {
					return;
				}
				started = true;

				handleStreamEvent(event, callbacks);

				const tokens = contextTokens(event as Record<string, unknown>);
				if (tokens !== undefined) context = tokens;
				// Final result: its text is checked for completion markers
				if (event.type === 'result') {
					run = readResultEvent(event as Record<string, unknown>);
					if (context !== undefined) run.contextTokens = context;
				}
			} catch (error) {
				// Log malformed JSON for debugging (non-JSON lines like system output are expected)
				if (line.trim().startsWith('{')) {
					const parseError = `Failed to parse JSON event: ${error instanceof Error ? error.message : 'Unknown error'}. Line: ${line.substring(0, 100)}...`;
					report(parseError, 'warning');
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
				report(
					`Failed to process stdout data: ${error instanceof Error ? error.message : 'Unknown error'}`,
					'warning'
				);
			}
		});

		child.stdout.on('end', () => {
			stdoutEnded = true;
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
			report(errorMessage);

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

			resolveOnce(createErrorIteration(iterationNum, startTime, errorMessage));
		});

		child.on('close', (exitCode: number | null) => {
			// Process remaining buffer only if stdout hasn't already ended
			if (!stdoutEnded && buffer) {
				processLine(buffer);
			}

			if (timedOut || exitCode === null) {
				const errorMsg = timedOut
					? silenceMessage(timeout)
					: 'Command terminated abnormally (no exit code)';
				report(errorMsg);
				resolveOnce(
					createErrorIteration(iterationNum, startTime, errorMsg, runSpend(run))
				);
				return;
			}

			resolveOnce(
				completeIteration(
					iterationNum,
					startTime,
					run?.text ?? '',
					exitCode,
					run,
					started
				)
			);
		});
	});
}
