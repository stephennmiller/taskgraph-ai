/**
 * @fileoverview ShowCommand using Commander's native class pattern
 * Extends Commander.Command for better integration with the framework
 */

import { type Task, type TmCore, createTmCore, TaskIdSchema } from '@tm/core';
import type { Subtask } from '@tm/core';
import chalk from 'chalk';
import { Command } from 'commander';
import { displayTaskDetails } from '../ui/components/task-detail.component.js';
import { displayCommandHeader } from '../utils/display-helpers.js';
import { displayError, printError } from '../utils/error-handler.js';
import { getProjectRoot } from '../utils/project-root.js';
import * as ui from '../utils/ui.js';
import { theme } from '../ui/theme.js';

/**
 * Options interface for the show command
 */
export interface ShowCommandOptions {
	id?: string;
	status?: string;
	format?: 'text' | 'json';
	json?: boolean;
	silent?: boolean;
	project?: string;
}

/**
 * Result type from show command
 */
export interface ShowTaskResult {
	task: Task | Subtask | null;
	found: boolean;
	originalTaskId?: string; // The original task ID requested (for subtasks like "104.1")
}

/**
 * Result type for multiple tasks
 */
export interface ShowMultipleTasksResult {
	tasks: (Task | Subtask)[];
	notFound: string[];
}

/**
 * ShowCommand extending Commander's Command class
 * This is a thin presentation layer over @tm/core
 */
export class ShowCommand extends Command {
	private tmCore?: TmCore;
	private lastResult?: ShowTaskResult | ShowMultipleTasksResult;
	private requestedId?: string;

	constructor(name?: string) {
		super(name || 'show');

		// Configure the command
		this.description('Display detailed information about one or more tasks')
			.argument('[id]', 'Task ID(s) to show (comma-separated for multiple)')
			.option(
				'-i, --id <id>',
				'Task ID(s) to show (comma-separated for multiple)'
			)
			.option('-s, --status <status>', 'Filter subtasks by status')
			.option('-f, --format <format>', 'Output format (text, json)', 'text')
			.option('--json', 'Output in JSON format (shorthand for --format json)')
			.option('--silent', 'Suppress output (useful for programmatic usage)')
			.option(
				'-p, --project <path>',
				'Project root directory (auto-detected if not provided)'
			)
			.action(
				async (taskId: string | undefined, options: ShowCommandOptions) => {
					await this.executeCommand(taskId, options);
				}
			);
	}

	/**
	 * Execute the show command
	 */
	private async executeCommand(
		taskId: string | undefined,
		options: ShowCommandOptions
	): Promise<void> {
		try {
			// Validate options
			if (!this.validateOptions(options)) {
				process.exit(1);
			}

			// Initialize tm-core
			await this.initializeCore(getProjectRoot(options.project));

			// Get the task ID from argument or option
			const idArg = taskId || options.id;
			if (!idArg) {
				printError('Missing task ID', 'Try `taskgraph show 3`');
				process.exit(1);
			}

			// Parse and validate task IDs (handle comma-separated values)
			const rawIds = idArg
				.split(',')
				.map((id) => id.trim())
				.filter((id) => id.length > 0);
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

			// Get tasks from core
			const result =
				taskIds.length > 1
					? await this.getMultipleTasks(taskIds, options)
					: await this.getSingleTask(taskIds[0], options);

			// Store result for programmatic access
			this.setLastResult(result);

			// Display results
			if (!options.silent) {
				this.displayResults(result, options);
			}
		} catch (error: any) {
			displayError(error);
		}
	}

	/**
	 * Validate command options
	 */
	private validateOptions(options: ShowCommandOptions): boolean {
		// Validate format
		if (options.format && !['text', 'json'].includes(options.format)) {
			console.error(chalk.red(`Invalid format: ${options.format}`));
			console.error(theme.muted(`Valid formats: text, json`));
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
	 * Get a single task from tm-core
	 */
	private async getSingleTask(
		taskId: string,
		_options: ShowCommandOptions
	): Promise<ShowTaskResult> {
		if (!this.tmCore) {
			throw new Error('TmCore not initialized');
		}

		// Get the task
		this.requestedId = taskId;
		const result = await this.tmCore.tasks.get(taskId);

		return {
			task: result.task,
			found: result.task !== null,
			originalTaskId: result.isSubtask ? taskId : undefined
		};
	}

	/**
	 * Get multiple tasks from tm-core
	 */
	private async getMultipleTasks(
		taskIds: string[],
		_options: ShowCommandOptions
	): Promise<ShowMultipleTasksResult> {
		if (!this.tmCore) {
			throw new Error('TmCore not initialized');
		}

		const tasks: (Task | Subtask)[] = [];
		const notFound: string[] = [];

		// Get each task individually
		for (const taskId of taskIds) {
			const result = await this.tmCore.tasks.get(taskId);
			if (result.task) {
				tasks.push(result.task);
			} else {
				notFound.push(taskId);
			}
		}

		return {
			tasks,
			notFound
		};
	}

	/**
	 * Display results based on format
	 */
	private displayResults(
		result: ShowTaskResult | ShowMultipleTasksResult,
		options: ShowCommandOptions
	): void {
		// If --json flag is set, override format to 'json'
		const format = options.json ? 'json' : options.format || 'text';

		switch (format) {
			case 'json':
				this.displayJson(result);
				// Scripts can tell a miss from a hit without parsing the JSON
				if ('found' in result && !result.found) {
					process.exitCode = 1;
				}
				break;

			case 'text':
			default:
				if ('task' in result) {
					// Single task result
					this.displaySingleTask(result, options);
				} else {
					// Multiple tasks result
					this.displayMultipleTasks(result, options);
				}
				break;
		}
	}

	/**
	 * Display in JSON format
	 */
	private displayJson(result: ShowTaskResult | ShowMultipleTasksResult): void {
		console.log(JSON.stringify(result, null, 2));
	}

	/**
	 * Display a single task in text format
	 */
	private displaySingleTask(
		result: ShowTaskResult,
		options: ShowCommandOptions
	): void {
		if (!result.found || !result.task) {
			const id = result.originalTaskId ?? this.requestedId ?? '';
			const parentId = id.includes('.') ? id.split('.')[0] : undefined;
			printError(
				`${parentId ? 'Subtask' : 'Task'} ${id} not found`,
				parentId
					? `Run \`taskgraph show ${parentId}\` to see its subtasks`
					: 'Run `taskgraph list` to see task IDs'
			);
			process.exitCode = 1;
			return;
		}

		const activeTag = this.tmCore?.config.getActiveTag() || 'master';
		displayCommandHeader({ tag: activeTag });

		console.log(); // Add spacing

		// Use the global task details display function
		// Pass the original requested ID if it's a subtask
		displayTaskDetails(result.task, {
			statusFilter: options.status,
			showSuggestedActions: true,
			originalTaskId: result.originalTaskId,
			checklist: this.tmCore?.tasks.getChecklist(
				result.task,
				Boolean(result.originalTaskId)
			)
		});
	}

	/**
	 * Display multiple tasks in text format
	 */
	private displayMultipleTasks(
		result: ShowMultipleTasksResult,
		_options: ShowCommandOptions
	): void {
		const activeTag = this.tmCore?.config.getActiveTag() || 'master';
		displayCommandHeader({ tag: activeTag });

		if (result.notFound.length > 0) {
			console.log(chalk.yellow(`\n⚠ Not found: ${result.notFound.join(', ')}`));
		}

		if (result.tasks.length === 0) {
			ui.displayWarning('No tasks found matching the criteria.');
			return;
		}

		// Task table
		console.log(theme.brand.bold(`\nTasks:\n`));
		console.log(
			ui.createTaskTable(result.tasks, {
				showSubtasks: true,
				showDependencies: true
			})
		);
	}

	/**
	 * Set the last result for programmatic access
	 */
	private setLastResult(
		result: ShowTaskResult | ShowMultipleTasksResult
	): void {
		this.lastResult = result;
	}

	/**
	 * Get the last result (for programmatic usage)
	 */
	getLastResult(): ShowTaskResult | ShowMultipleTasksResult | undefined {
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
	static register(program: Command, name?: string): ShowCommand {
		const showCommand = new ShowCommand(name);
		program.addCommand(showCommand);
		return showCommand;
	}
}
