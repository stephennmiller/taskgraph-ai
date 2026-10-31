/**
 * @fileoverview ShowCommand using Commander's native class pattern
 * Extends Commander.Command for better integration with the framework
 */

import {
	type Task,
	type TmCore,
	createTmCore,
	fenceAsData,
	neutralizeTaskData,
	TASK_DATA_TAG,
	TaskIdSchema,
	withFullSubtaskIds
} from '@tm/core';
import type { Subtask } from '@tm/core';
import chalk from 'chalk';
import { Command } from 'commander';
import { formatTaskDetail } from '../ui/formatters/task-detail-formatters.js';
import { displayCommandHeader } from '../utils/display-helpers.js';
import { displayError, printError } from '../utils/error-handler.js';
import { jsonOption, printJson } from '../utils/json-output.js';
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
	tag?: string;
}

/**
 * Result type from show command
 */
export interface ShowTaskResult {
	task: ShownTask | null;
	found: boolean;
	originalTaskId?: string; // The original task ID requested (for subtasks like "104.1")
}

/** A task with the PRD section it cites, as written (`tasks.getPrdSection`) */
type ShownTask = (Task | Subtask) & {
	prdSection?: { source: string; text: string };
};

/**
 * Result type for multiple tasks
 */
export interface ShowMultipleTasksResult {
	tasks: ShownTask[];
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
	/** The single task shown waits on unfinished dependencies */
	private blocked = false;

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
			.option('-t, --tag <tag>', 'Use a specific tag')
			.option('-f, --format <format>', 'Output format (text, json)', 'text')
			.addOption(jsonOption())
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
		options: ShowCommandOptions
	): Promise<ShowTaskResult> {
		if (!this.tmCore) {
			throw new Error('TmCore not initialized');
		}

		// Get the task
		this.requestedId = taskId;
		const result = await this.tmCore.tasks.get(taskId, options.tag);
		if (result.task) {
			this.blocked = (
				await this.tmCore.tasks.explainBlockers(taskId, { tag: options.tag })
			).blocked;
		}

		return {
			task: await this.withPrdSection(taskId, result.task, options.tag),
			found: result.task !== null,
			originalTaskId: result.isSubtask ? taskId : undefined
		};
	}

	/** The task with its PRD section; null stays null, so a missing subtask gets no parent section */
	private async withPrdSection(
		taskId: string,
		task: Task | Subtask | null,
		tag?: string
	): Promise<ShownTask | null> {
		if (!task || !this.tmCore) return task;
		const prdSection = await this.tmCore.tasks.getPrdSection(taskId, tag);
		return prdSection ? { ...task, prdSection } : task;
	}

	/**
	 * Get multiple tasks from tm-core
	 */
	private async getMultipleTasks(
		taskIds: string[],
		options: ShowCommandOptions
	): Promise<ShowMultipleTasksResult> {
		if (!this.tmCore) {
			throw new Error('TmCore not initialized');
		}

		const tasks: ShownTask[] = [];
		const notFound: string[] = [];

		// Get each task individually
		for (const taskId of taskIds) {
			const result = await this.tmCore.tasks.get(taskId, options.tag);
			const task = await this.withPrdSection(taskId, result.task, options.tag);
			if (task) {
				tasks.push(task);
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
		// --json sets format to json unless --format is typed too (jsonOption)
		const format = options.format ?? (options.json ? 'json' : 'text');

		switch (format) {
			case 'json':
				this.displayJson(result);
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
		// Any missed ID fails the command, in either format (#808)
		if ('found' in result ? !result.found : result.notFound.length > 0) {
			process.exitCode = 1;
		}
	}

	/**
	 * Display in JSON format
	 */
	private displayJson(result: ShowTaskResult | ShowMultipleTasksResult): void {
		// Titles and details may be read by an agent: none can close a fence
		printJson(
			neutralizeTaskData(
				'tasks' in result
					? { ...result, tasks: result.tasks.map(withFullSubtaskIds) }
					: {
							...result,
							task: withFullSubtaskIds(result.task)
						}
			)
		);
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
			return;
		}

		const activeTag =
			options.tag || this.tmCore?.config.getActiveTag() || 'master';
		const headerShown = displayCommandHeader({
			tag: activeTag,
			projectRoot: this.tmCore?.projectPath
		});
		// Separate the tag line from the task; with no tag line, start with the task
		if (headerShown) console.log();
		console.log(
			formatTaskDetail(result.task, {
				id: result.originalTaskId,
				prdSection: result.task.prdSection,
				statusFilter: options.status,
				blocked: this.blocked,
				checklist: this.tmCore?.tasks.getChecklist(
					result.task,
					Boolean(result.originalTaskId)
				)
			})
		);
	}

	/**
	 * Display multiple tasks in text format
	 */
	private displayMultipleTasks(
		result: ShowMultipleTasksResult,
		options: ShowCommandOptions
	): void {
		// Every ID missed: one error, as for a single ID, not a warning and a box
		if (result.tasks.length === 0) {
			printError(
				`Tasks ${result.notFound.join(', ')} not found`,
				'Run `taskgraph list` to see task IDs'
			);
			return;
		}

		const activeTag =
			options.tag || this.tmCore?.config.getActiveTag() || 'master';
		// A blank line separates each block from the one above it, but nothing
		// comes before the first block
		let printed = displayCommandHeader({
			tag: activeTag,
			projectRoot: this.tmCore?.projectPath
		});

		if (result.notFound.length > 0) {
			const gap = printed ? '\n' : '';
			console.log(
				chalk.yellow(`${gap}⚠ Not found: ${result.notFound.join(', ')}`)
			);
			printed = true;
		}

		// Task table
		console.log(theme.brand.bold(`${printed ? '\n' : ''}Tasks:\n`));
		console.log(
			fenceAsData(
				ui.createTaskTable(result.tasks, {
					showSubtasks: true,
					showDependencies: true
				}),
				TASK_DATA_TAG
			)
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
