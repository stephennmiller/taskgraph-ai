/**
 * @fileoverview StartCommand using Commander's native class pattern
 * Extends Commander.Command for better integration with the framework
 * This is a thin presentation layer over @tm/core's TaskExecutionService
 */

import { spawn } from 'child_process';
import {
	type StartTaskResult as CoreStartTaskResult,
	type Subtask,
	type Task,
	type TaskChecklist,
	type TmCore,
	createTmCore
} from '@tm/core';
import { Command } from 'commander';
import {
	formatStartFailed,
	formatStartLaunching,
	formatStartSessionEnded
} from '../ui/formatters/start-formatters.js';
import { formatTaskDetail } from '../ui/formatters/task-detail-formatters.js';
import { theme } from '../ui/theme.js';
import { displayError, printError } from '../utils/error-handler.js';
import { getProjectRoot } from '../utils/project-root.js';

/**
 * CLI-specific options interface for the start command
 */
export interface StartCommandOptions {
	id?: string;
	format?: 'text' | 'json';
	project?: string;
	dryRun?: boolean;
	force?: boolean;
	noStatusUpdate?: boolean;
}

/**
 * Result type from start command
 */
export type StartCommandResult = CoreStartTaskResult;

/**
 * StartCommand extending Commander's Command class
 * This is a thin presentation layer over @tm/core's TaskExecutionService
 */
export class StartCommand extends Command {
	private tmCore?: TmCore;
	private lastResult?: StartCommandResult;

	constructor(name?: string) {
		super(name || 'start');

		// Configure the command
		this.description(
			'Start working on a task by launching claude-code with context'
		)
			.argument('[id]', 'Task ID to start working on')
			.option('-i, --id <id>', 'Task ID to start working on')
			.option('-f, --format <format>', 'Output format (text, json)', 'text')
			.option(
				'-p, --project <path>',
				'Project root directory (auto-detected if not provided)'
			)
			.option(
				'--dry-run',
				'Show what would be executed without launching claude-code'
			)
			.option(
				'--force',
				'Force start even if another task is already in-progress'
			)
			.option(
				'--no-status-update',
				'Do not automatically update task status to in-progress'
			)
			.action(
				async (taskId: string | undefined, options: StartCommandOptions) => {
					await this.executeCommand(taskId, options);
				}
			);
	}

	/**
	 * Execute the start command
	 */
	private async executeCommand(
		taskId: string | undefined,
		options: StartCommandOptions
	): Promise<void> {
		try {
			// Validate options
			if (!this.validateOptions(options)) {
				process.exit(1);
			}

			await this.initializeCore(getProjectRoot(options.project));

			// Get the task ID from argument or option, or find next available task
			const targetTaskId =
				taskId || options.id || (await this.performGetNextTask());

			if (!targetTaskId) {
				printError(
					'No task is ready to start',
					'Run `taskgraph list` to see what is blocked, or pass a task ID'
				);
				process.exit(1);
			}

			const coreResult = await this.performStartTask(targetTaskId, options);
			const result: StartCommandResult = coreResult;
			this.setLastResult(result);
			const json = options.format === 'json';

			if (!coreResult.found || !coreResult.task || !coreResult.started) {
				if (json) {
					this.displayJson(result);
				} else {
					const failure = formatStartFailed(targetTaskId, coreResult);
					printError(failure.message, failure.hint);
				}
				process.exitCode = 1;
				return;
			}

			const label = this.workItemLabel(coreResult, targetTaskId);

			if (options.dryRun) {
				if (json) {
					this.displayJson(result);
					return;
				}
				// The task or subtask being started, as `show` prints it, with
				// its checklist numbered as set-status --check takes it
				const item = await this.loadWorkItem(coreResult, label);
				const checklist = await this.tmCore?.tasks.loadChecklist(label.id);
				this.displayDryRun(item, label, checklist);
				return;
			}

			// Execute command if we have one
			if (coreResult.command) {
				const title =
					label.kind === 'subtask'
						? coreResult.subtask?.title
						: coreResult.task.title;
				if (!json) console.log(formatStartLaunching(label, title ?? ''));
				await this.executeChildProcess(coreResult.command);
				if (!json) console.log(formatStartSessionEnded(label.id));
			}
		} catch (error: any) {
			displayError(error);
		}
	}

	/**
	 * The task or subtask being started. A subtask is loaded by its full ID
	 * and knows its parent, so its dependencies show as `2.1`, not `1`.
	 */
	private async loadWorkItem(
		result: CoreStartTaskResult,
		label: { id: string; kind: 'task' | 'subtask' }
	): Promise<Task | Subtask> {
		const task = result.task as Task;
		if (label.kind === 'task') return task;
		const found = await this.tmCore?.tasks.get(label.id);
		if (!found?.task || !found.isSubtask) return task;
		return { ...found.task, parentId: found.task.parentId ?? String(task.id) };
	}

	/** `subtask 2.2` or `task 3`, for the lines around the session */
	private workItemLabel(
		result: CoreStartTaskResult,
		targetTaskId: string
	): { id: string; kind: 'task' | 'subtask' } {
		if (result.subtask && result.subtaskId && result.task) {
			return { id: `${result.task.id}.${result.subtaskId}`, kind: 'subtask' };
		}
		return {
			id: result.task ? String(result.task.id) : targetTaskId,
			kind: 'task'
		};
	}

	/**
	 * Validate command options
	 */
	private validateOptions(options: StartCommandOptions): boolean {
		// Validate format
		if (options.format && !['text', 'json'].includes(options.format)) {
			printError(
				`"${options.format}" isn't an output format`,
				'Use --format text or --format json'
			);
			return false;
		}

		return true;
	}

	/**
	 * Initialize TmCore
	 */
	private async initializeCore(projectRoot: string): Promise<void> {
		if (!this.tmCore) {
			this.tmCore = await createTmCore({ projectPath: projectRoot });
		}
	}

	/**
	 * Get the next available task using tm-core
	 */
	private async performGetNextTask(): Promise<string | null> {
		if (!this.tmCore) {
			throw new Error('TmCore not initialized');
		}
		return this.tmCore.tasks.getNextAvailable();
	}

	/**
	 * Perform start task using tm-core business logic
	 */
	private async performStartTask(
		targetTaskId: string,
		options: StartCommandOptions
	): Promise<CoreStartTaskResult> {
		if (!this.tmCore) {
			throw new Error('TmCore not initialized');
		}

		// Get execution command from tm-core (instead of executing directly)
		const result = await this.tmCore.tasks.start(targetTaskId, {
			dryRun: options.dryRun,
			force: options.force,
			updateStatus: !options.noStatusUpdate
		});

		if (!result) {
			throw new Error('Failed to start task - core result is undefined');
		}

		// Don't execute here - let the main executeCommand method handle it
		return result;
	}

	/**
	 * Execute the child process directly in the main thread for better process control
	 */
	private async executeChildProcess(command: {
		executable: string;
		args: string[];
		cwd: string;
	}): Promise<void> {
		return new Promise((resolve, reject) => {
			const childProcess = spawn(command.executable, command.args, {
				cwd: command.cwd,
				stdio: 'inherit', // Inherit stdio from parent process
				shell: false
			});

			childProcess.on('close', (code) => {
				if (code === 0) {
					resolve();
				} else {
					reject(new Error(`Process exited with code ${code}`));
				}
			});

			childProcess.on('error', (error) => {
				reject(new Error(`Failed to spawn process: ${error.message}`));
			});

			// Handle process termination signals gracefully
			const cleanup = () => {
				if (childProcess && !childProcess.killed) {
					childProcess.kill('SIGTERM');
				}
			};

			process.on('SIGINT', cleanup);
			process.on('SIGTERM', cleanup);
			process.on('exit', cleanup);
		});
	}

	/**
	 * Display in JSON format
	 */
	private displayJson(result: StartCommandResult): void {
		console.log(JSON.stringify(result, null, 2));
	}

	/**
	 * `--dry-run`: the task as `show` prints it, ending with how to launch it
	 */
	private displayDryRun(
		item: Task | Subtask,
		label: { id: string; kind: 'task' | 'subtask' },
		checklist?: TaskChecklist
	): void {
		console.log(
			theme.muted(
				`Dry run · Claude Code not launched for ${label.kind} ${label.id}`
			)
		);
		console.log();
		console.log(
			formatTaskDetail(item, {
				id: label.id,
				checklist,
				next: {
					command: `taskgraph start ${label.id}`,
					description: 'to launch Claude Code'
				}
			})
		);
	}

	/**
	 * Set the last result for programmatic access
	 */
	private setLastResult(result: StartCommandResult): void {
		this.lastResult = result;
	}

	/**
	 * Get the last result (for programmatic usage)
	 */
	getLastResult(): StartCommandResult | undefined {
		return this.lastResult;
	}

	/**
	 * Clean up resources
	 */
	async cleanup(): Promise<void> {
		if (this.tmCore) {
			this.tmCore = undefined;
		}
	}

	/**
	 * Register this command on an existing program
	 */
	static register(program: Command, name?: string): StartCommand {
		const startCommand = new StartCommand(name);
		program.addCommand(startCommand);
		return startCommand;
	}
}
