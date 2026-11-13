/**
 * @fileoverview ShowCommand using Commander's native class pattern
 * Extends Commander.Command for better integration with the framework
 */

import {
	type Task,
	type TmCore,
	createTmCore,
	formatTaskData,
	neutralizeTaskData,
	parseTaskIds,
	withFullSubtaskIds
} from '@tm/core';
import type { Subtask } from '@tm/core';
import chalk from 'chalk';
import { Command } from 'commander';
import { projectOption, tagOption } from '../utils/shared-options.js';
import {
	type TaskDetailOptions,
	formatTaskDetail
} from '../ui/formatters/task-detail-formatters.js';
import { formatPlainTaskList } from '../ui/formatters/task-list-formatters.js';
import { displayCommandHeader } from '../utils/display-helpers.js';
import { displayError, printError } from '../utils/error-handler.js';
import { jsonOption, printJson } from '../utils/json-output.js';
import { getProjectRoot } from '../utils/project-root.js';
import {
	fencesTaskData,
	shellOptsOutOfTaskDataFence
} from '../ui/layout/helpers.js';
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
	/**
	 * What the text of each task found also shows: its full ID when it's a
	 * subtask, whether it waits on dependencies, the commits that name it
	 * (#954) and the subtask statuses `--status` kept
	 */
	private detail = new Map<ShownTask, TaskDetailOptions>();

	constructor(name?: string) {
		super(name || 'show');

		// Configure the command
		this.description('Show one task in detail')
			.argument('[id]', 'Task or subtask ID; several with commas (3,3.2)')
			.option('-i, --id <id>', 'The same as the [id] argument')
			.option('-s, --status <status>', 'Only show subtasks with this status')
			.addOption(tagOption())
			.option('-f, --format <format>', 'Output format: text or json', 'text')
			.addOption(jsonOption())
			.option('--silent', 'Print nothing')
			.addOption(projectOption())
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

			// Every ID is checked before any is read (throws with a hint)
			const taskIds = parseTaskIds(idArg);

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
			// Any missed ID fails the command, in any format and with --silent (#808)
			if ('found' in result ? !result.found : result.notFound.length > 0) {
				process.exitCode = 1;
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
		const result = await this.tmCore.tasks.get(taskId, options.tag, {
			subtaskStatus: options.status
		});
		const task = await this.withPrdSection(taskId, result.task, options.tag);
		// The stored ID ("1.3" for "01.03"), or as typed when not found
		const originalTaskId = result.isSubtask
			? String(result.task?.id ?? taskId)
			: undefined;
		if (task) {
			this.detail.set(task, {
				id: originalTaskId,
				subtaskFilter:
					'subtaskFilter' in result ? result.subtaskFilter : undefined,
				blocked: (
					await this.tmCore.tasks.explainBlockers(taskId, { tag: options.tag })
				).blocked,
				commits: await this.tmCore.tasks.getCommits(taskId, options.tag)
			});
		}

		return { task, found: task !== null, originalTaskId };
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
		const tasks: ShownTask[] = [];
		const notFound: string[] = [];

		// Get each task individually
		for (const taskId of taskIds) {
			const { task } = await this.getSingleTask(taskId, options);
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
		console.log(this.formatTask(result.task));
	}

	/** One task as `show <id>` prints it */
	private formatTask(task: ShownTask, nextStep = true): string {
		const detail = this.detail.get(task);
		return formatTaskDetail(task, {
			...detail,
			prdSection: task.prdSection,
			rawText: !process.stdout.isTTY,
			checklist: this.tmCore?.tasks.getChecklist(task, Boolean(detail?.id)),
			fence: fencesTaskData() && !shellOptsOutOfTaskDataFence(),
			nextStep
		});
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

		// A pipe gets list's plain lines: no heading, box or color (#1069)
		if (
			!process.stdout.isTTY &&
			this.getOptionValueSource('format') !== 'cli'
		) {
			const gap = printed ? '\n' : '';
			console.log(
				gap +
					formatTaskData(
						formatPlainTaskList(result.tasks, { withSubtasks: true }),
						!shellOptsOutOfTaskDataFence()
					)
			);
			return;
		}

		// Each task as `show <id>` prints it. Which of them to act on next is
		// the reader's call, so no `Next:` line
		console.log(
			(printed ? '\n' : '') +
				result.tasks.map((task) => this.formatTask(task, false)).join('\n\n')
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
