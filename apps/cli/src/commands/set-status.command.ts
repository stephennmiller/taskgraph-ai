/**
 * @fileoverview SetStatusCommand using Commander's native class pattern
 * Extends Commander.Command for better integration with the framework
 */

import {
	type TaskChecklist,
	type TaskStatus,
	type TmCore,
	createTmCore,
	getUncheckedCriteria,
	parseChecklistNumbers,
	TaskIdSchema
} from '@tm/core';
import { Command } from 'commander';
import {
	formatChecklistUpdate,
	formatUncheckedCriteria
} from '../ui/formatters/checklist-formatters.js';
import { formatStatusChanges } from '../ui/formatters/status-change-formatters.js';
import { displayError, printError } from '../utils/error-handler.js';
import { printJson } from '../utils/json-output.js';
import { getProjectRoot } from '../utils/project-root.js';

/**
 * Valid task status values for validation
 */
const VALID_TASK_STATUSES: TaskStatus[] = [
	'pending',
	'in-progress',
	'done',
	'deferred',
	'cancelled',
	'blocked',
	'review'
];

/**
 * Options interface for the set-status command
 */
export interface SetStatusCommandOptions {
	id?: string;
	status?: TaskStatus;
	format?: 'text' | 'json';
	silent?: boolean;
	project?: string;
	/** Checklist numbers to check off, as typed ("2", "2,4") */
	check?: string[];
	/** Checklist numbers to clear again */
	uncheck?: string[];
	/** Mark done even with unchecked criteria */
	force?: boolean;
}

/** Commander collector for a repeatable option */
const collect = (value: string, previous: string[] = []) => [
	...previous,
	value
];

/**
 * Result type from set-status command
 */
export interface SetStatusResult {
	success: boolean;
	updatedTasks: Array<{
		taskId: string;
		oldStatus: TaskStatus;
		newStatus: TaskStatus;
	}>;
	/** The task's checklist after --check/--uncheck */
	checklist?: TaskChecklist & { taskId: string };
}

/**
 * SetStatusCommand extending Commander's Command class
 * This is a thin presentation layer over @tm/core
 */
export class SetStatusCommand extends Command {
	private tmCore?: TmCore;
	private lastResult?: SetStatusResult;

	constructor(name?: string) {
		super(name || 'set-status');

		// Configure the command with positional arguments
		this.description('Update the status of one or more tasks')
			.alias('status')
			.argument(
				'[id]',
				'Task ID(s) - comma-separated for multiple (e.g., 1 or 1,1.1,2)'
			)
			.argument('[status]', `Status - ${VALID_TASK_STATUSES.join(', ')}`)
			.option('-i, --id <id>', 'Task ID(s) (fallback if not using positional)')
			.option(
				'-s, --status <status>',
				'Status (fallback if not using positional)'
			)
			.option(
				'--check <numbers>',
				'Check off criteria by number, e.g. 2 or 2,4 (see show)',
				collect
			)
			.option(
				'--uncheck <numbers>',
				'Clear checked criteria by number',
				collect
			)
			.option('--force', 'Mark done even with unchecked criteria')
			.option('-f, --format <format>', 'Output format (text, json)', 'text')
			.option('--silent', 'Suppress output (useful for programmatic usage)')
			.option(
				'-p, --project <path>',
				'Project root directory (auto-detected if not provided)'
			)
			.action(
				async (
					idArg?: string,
					statusArg?: string,
					options?: SetStatusCommandOptions
				) => {
					// Prioritize positional arguments over options
					const mergedOptions: SetStatusCommandOptions = {
						...options,
						id: idArg || options?.id,
						status: (statusArg as TaskStatus) || options?.status
					};
					await this.executeCommand(mergedOptions);
				}
			);
	}

	/**
	 * Execute the set-status command
	 */
	private async executeCommand(
		options: SetStatusCommandOptions
	): Promise<void> {
		let hasError = false;
		try {
			// Validate required options
			if (!options.id) {
				printError(
					'Missing task ID',
					'Try `taskgraph set-status --id=3 --status=done`'
				);
				process.exit(1);
			}

			const changesChecklist = Boolean(options.check || options.uncheck);
			let check: number[] = [];
			let uncheck: number[] = [];
			if (changesChecklist) {
				try {
					check = parseChecklistNumbers(options.check ?? []);
					uncheck = parseChecklistNumbers(options.uncheck ?? []);
				} catch (error: any) {
					printError(
						error.message,
						`Use the numbers \`taskgraph show ${options.id}\` lists, e.g. --check 1,2`
					);
					process.exit(1);
				}
				if (options.id.includes(',')) {
					printError(
						'--check and --uncheck take one task ID',
						`Try \`taskgraph set-status ${options.id.split(',')[0].trim()} --check 1\``
					);
					process.exit(1);
				}
			}

			if (!options.status && !changesChecklist) {
				printError(
					'Missing status',
					`Try \`taskgraph set-status --id=${options.id} --status=done\``
				);
				process.exit(1);
			}

			// Validate status
			if (options.status && !VALID_TASK_STATUSES.includes(options.status)) {
				printError(
					`"${options.status}" isn't a status`,
					`Use one of: ${VALID_TASK_STATUSES.join(', ')}`
				);
				process.exit(1);
			}

			// Initialize TaskGraph core
			this.tmCore = await createTmCore({
				projectPath: getProjectRoot(options.project)
			});

			// Parse and validate task IDs (handle comma-separated values)
			const rawIds = options.id.split(',').map((id) => id.trim());
			const taskIds: string[] = [];

			for (const rawId of rawIds) {
				const parseResult = TaskIdSchema.safeParse(rawId);
				if (!parseResult.success) {
					printError(
						`"${rawId}" isn't a task ID`,
						'Use a number like `3`, or `3.1` for a subtask'
					);
					process.exit(1);
				}
				taskIds.push(parseResult.data);
			}

			let checklist: (TaskChecklist & { taskId: string }) | undefined;
			if (changesChecklist) {
				try {
					checklist = {
						taskId: taskIds[0],
						...(await this.tmCore.tasks.updateChecklist(taskIds[0], {
							check,
							uncheck
						}))
					};
				} catch (error: any) {
					if (options.format === 'json') {
						printJson(
							{
								success: false,
								error: error?.getUserMessage?.() ?? error?.message,
								taskId: taskIds[0]
							},
							{ compact: true }
						);
					} else if (!options.silent) {
						displayError(error, {
							skipExit: true,
							hint: `Run \`taskgraph show ${taskIds[0]}\` to see its criteria`
						});
					}
					process.exit(1);
				}
			}

			// Update each task
			const updatedTasks: Array<{
				taskId: string;
				oldStatus: TaskStatus;
				newStatus: TaskStatus;
			}> = [];
			let failure: unknown;

			for (const taskId of options.status ? taskIds : []) {
				try {
					const result = await this.tmCore.tasks.updateStatus(
						taskId,
						options.status as TaskStatus,
						undefined,
						{ force: options.force }
					);
					updatedTasks.push({
						taskId: result.taskId,
						oldStatus: result.oldStatus,
						newStatus: result.newStatus
					});
				} catch (error: any) {
					hasError = true;
					if (options.format === 'json') {
						const errorMessage = error?.getSanitizedDetails
							? error.getSanitizedDetails().message
							: error instanceof Error
								? error.message
								: String(error);

						const gate = getUncheckedCriteria(error);
						printJson(
							{
								success: false,
								error: errorMessage,
								taskId,
								...(gate && { unchecked: gate.unchecked }),
								// --check was saved before the status failed
								...(checklist && { checklist }),
								timestamp: new Date().toISOString()
							},
							{ compact: true }
						);
					} else {
						failure = error;
					}
					// Don't exit here - let finally block clean up first
					break;
				}
			}

			// Store result for potential reuse
			this.lastResult = {
				success: !hasError,
				updatedTasks,
				...(checklist && { checklist })
			};

			// Report what did change before the task that stopped the run; a
			// JSON failure has already been printed and stands on its own
			const showResults =
				(updatedTasks.length > 0 || checklist !== undefined) &&
				!(hasError && options.format === 'json');
			if (showResults || !hasError) {
				this.displayResults(this.lastResult, options);
			}
			if (failure !== undefined && !options.silent) {
				const gate = getUncheckedCriteria(failure);
				if (gate) {
					console.error(
						`\n${formatUncheckedCriteria((failure as Error).message, gate.taskId, gate.unchecked)}`
					);
				} else {
					displayError(failure, { skipExit: true });
				}
			}
		} catch (error: any) {
			hasError = true;
			if (options.format === 'json') {
				const errorMessage =
					error instanceof Error ? error.message : 'Unknown error occurred';
				printJson({ success: false, error: errorMessage }, { compact: true });
			} else if (!options.silent) {
				displayError(error, { skipExit: true });
			}
		} finally {
			// Clean up resources
			if (this.tmCore) {
			}
		}

		// Exit after cleanup completes
		if (hasError) {
			process.exit(1);
		}
	}

	/**
	 * Display results based on format
	 */
	private displayResults(
		result: SetStatusResult,
		options: SetStatusCommandOptions
	): void {
		const format = options.format || 'text';

		switch (format) {
			case 'json':
				printJson(result);
				break;

			case 'text':
			default:
				if (!options.silent) {
					this.displayTextResults(result);
				}
				break;
		}
	}

	/**
	 * Display results in text format
	 */
	private displayTextResults(result: SetStatusResult): void {
		const lines: string[] = [];
		// A task that reached done already says its checklist is clear
		const reachedDone = result.updatedTasks.some(
			(change) => change.newStatus === 'done'
		);
		if (result.checklist && !reachedDone) {
			lines.push(
				formatChecklistUpdate(result.checklist.taskId, result.checklist)
			);
		}
		if (result.updatedTasks.length > 0) {
			// One line per change: set-status runs many times a day
			lines.push(formatStatusChanges(result.updatedTasks));
		}
		// The result is the first line: no leading blank line (#273)
		if (lines.length > 0) console.log(lines.join('\n'));
	}

	/**
	 * Get the last command result (useful for testing or chaining)
	 */
	getLastResult(): SetStatusResult | undefined {
		return this.lastResult;
	}

	/**
	 * Register this command on an existing program
	 */
	static register(program: Command, name?: string): SetStatusCommand {
		const setStatusCommand = new SetStatusCommand(name);
		program.addCommand(setStatusCommand);
		return setStatusCommand;
	}
}

/**
 * Factory function to create and configure the set-status command
 */
export function createSetStatusCommand(): SetStatusCommand {
	return new SetStatusCommand();
}
