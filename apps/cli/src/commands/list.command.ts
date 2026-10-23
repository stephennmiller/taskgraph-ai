/**
 * @fileoverview ListTasks command using Commander's native class pattern
 * Extends Commander.Command for better integration with the framework
 */

import {
	OUTPUT_FORMATS,
	buildBlocksMap,
	createTmCore,
	filterBlockingTasks,
	filterReadyTasks,
	satisfyArchivedDependencies,
	type InvalidDependency,
	type OutputFormat,
	STATUS_ICONS,
	TASK_STATUSES,
	type TaskStatus,
	type TmCore,
	type WatchSubscription
} from '@tm/core';
import chalk from 'chalk';
import { Command } from 'commander';
import {
	displaySyncMessage,
	displayWatchFooter,
	formatEmptyList,
	formatListNextStep,
	formatListSummary,
	formatPlainTaskList
} from '../ui/index.js';
import { displayCommandHeader } from '../utils/display-helpers.js';
import { displayError } from '../utils/error-handler.js';
import { printJson } from '../utils/json-output.js';
import { getProjectRoot } from '../utils/project-root.js';
import { theme } from '../ui/theme.js';
import * as ui from '../utils/ui.js';
import {
	type ListCommandOptions,
	type ListTasksResult,
	type TaskWithTag,
	shouldPrintPlainList
} from './list.types.js';

export {
	type ListCommandOptions,
	type ListTasksResult,
	type TaskWithTag,
	shouldPrintPlainList
} from './list.types.js';

/**
 * ListTasksCommand extending Commander's Command class
 * This is a thin presentation layer over @tm/core
 */
export class ListTasksCommand extends Command {
	private tmCore?: TmCore;
	private lastResult?: ListTasksResult;

	constructor(name?: string) {
		super(name || 'list');

		// Configure the command with positional status argument
		this.description('List tasks with optional filtering')
			.alias('ls')
			.argument(
				'[status]',
				'Filter by status (e.g., pending, done, in-progress) or "all" to show with subtasks'
			)
			.option(
				'-s, --status <status>',
				'Filter by status (fallback if not using positional)'
			)
			.option('-t, --tag <tag>', 'Filter by tag')
			.option('--with-subtasks', 'Include subtasks in the output')
			.option(
				'-f, --format <format>',
				'Output format (text, json, compact)',
				'text'
			)
			.option('--json', 'Output in JSON format (shorthand for --format json)')
			.option(
				'-c, --compact',
				'Output in compact format (shorthand for --format compact)'
			)
			.option('--no-header', 'Hide the command header')
			.option('--silent', 'Suppress output (useful for programmatic usage)')
			.option(
				'-p, --project <path>',
				'Project root directory (auto-detected if not provided)'
			)
			.option('-w, --watch', 'Watch for changes and update list automatically')
			.option(
				'--ready',
				'Show only tasks ready to work on (dependencies satisfied)'
			)
			.option('--blocking', 'Show only tasks that block other tasks')
			.option(
				'--all-tags',
				'Show tasks from all tags (combine with --ready for actionable tasks)'
			)
			.action(async (statusArg?: string, options?: ListCommandOptions) => {
				// Handle special "all" keyword to show with subtasks
				let status = statusArg || options?.status;
				let withSubtasks = options?.withSubtasks || false;

				if (statusArg === 'all') {
					// "all" means show all tasks with subtasks expanded
					status = undefined;
					withSubtasks = true;
				}

				// Prioritize positional argument over option
				const mergedOptions: ListCommandOptions = {
					...options,
					status,
					withSubtasks
				};
				mergedOptions.plain = shouldPrintPlainList(
					mergedOptions,
					this.getOptionValueSource('format') === 'cli'
				);
				await this.executeCommand(mergedOptions);
			});
	}

	/**
	 * Execute the list command
	 */
	private async executeCommand(options: ListCommandOptions): Promise<void> {
		try {
			// Validate options
			if (!this.validateOptions(options)) {
				process.exit(1);
			}

			// Initialize tm-core (project root auto-detected if not provided)
			await this.initializeCore(getProjectRoot(options.project));

			// Get tasks from core
			if (options.watch) {
				await this.watchTasks(options);
			} else {
				// Use cross-tag listing when --all-tags is specified
				const result = options.allTags
					? await this.getTasksFromAllTags(options)
					: await this.getTasks(options);

				// Store result for programmatic access
				this.setLastResult(result);

				// Display results
				if (!options.silent) {
					this.displayResults(result, options);
				}
			}
		} catch (error: any) {
			displayError(error);
		}
	}

	/**
	 * Watch for changes and update list
	 * Uses tm-core's watch API on the tasks file
	 */
	private async watchTasks(options: ListCommandOptions): Promise<void> {
		if (!this.tmCore) {
			throw new Error('TmCore not initialized');
		}

		// Initial render
		let result = await this.getTasks(options);
		let lastSync = new Date();

		console.clear();
		this.displayResults(result, options);

		displayWatchFooter(lastSync);

		let subscription: WatchSubscription | undefined;

		try {
			// Subscribe to task changes via tm-core
			subscription = await this.tmCore.tasks.watch(
				async (event) => {
					if (event.type === 'change') {
						try {
							// Re-fetch tasks
							result = await this.getTasks(options);
							lastSync = new Date();

							// Clear and display
							console.clear();
							this.displayResults(result, options);

							// Show sync message with timestamp
							displaySyncMessage(lastSync);
							displayWatchFooter(lastSync);
						} catch (refreshError: unknown) {
							// Log warning but continue watching - don't crash on transient errors
							const message =
								refreshError instanceof Error
									? refreshError.message
									: String(refreshError);
							console.error(
								chalk.yellow(`\nWarning: Failed to refresh tasks: ${message}`)
							);
						}
					} else if (event.type === 'error' && event.error) {
						console.error(chalk.red(`\n⚠ Watch error: ${event.error.message}`));
					}
				},
				{ tag: options.tag }
			);

			// Cleanup on process termination
			const cleanup = () => {
				subscription?.unsubscribe();
				process.exit(0);
			};
			process.on('SIGINT', cleanup);
			process.on('SIGTERM', cleanup);

			// Keep process alive
			await new Promise(() => {});
		} catch (error: any) {
			console.error(chalk.red(`Watch mode error: ${error.message}`));
			throw error;
		}
	}

	/**
	 * Validate command options
	 */
	private validateOptions(options: ListCommandOptions): boolean {
		// Validate format
		if (
			options.format &&
			!OUTPUT_FORMATS.includes(options.format as OutputFormat)
		) {
			console.error(chalk.red(`Invalid format: ${options.format}`));
			console.error(theme.muted(`Valid formats: ${OUTPUT_FORMATS.join(', ')}`));
			return false;
		}

		// Validate status
		if (options.status) {
			const statuses = options.status.split(',').map((s: string) => s.trim());

			for (const status of statuses) {
				if (status !== 'all' && !TASK_STATUSES.includes(status as TaskStatus)) {
					console.error(chalk.red(`Invalid status: ${status}`));
					console.error(
						theme.muted(`Valid statuses: ${TASK_STATUSES.join(', ')}`)
					);
					return false;
				}
			}
		}

		// Validate --all-tags cannot be used with --watch
		if (options.allTags && options.watch) {
			console.error(chalk.red('--all-tags cannot be used with --watch mode'));
			console.error(
				theme.muted(
					'Use --all-tags without --watch, or --watch without --all-tags'
				)
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
	 * Get tasks from tm-core
	 */
	private async getTasks(
		options: ListCommandOptions
	): Promise<ListTasksResult> {
		if (!this.tmCore) {
			throw new Error('TmCore not initialized');
		}

		// Parse status filter values
		const statusFilterValues =
			options.status && options.status !== 'all'
				? options.status.split(',').map((s: string) => s.trim() as TaskStatus)
				: undefined;

		// The text view prints a summary of the whole tag above the table, and
		// the task `next` picks; JSON, compact and --ready/--blocking don't
		const showsSummary =
			!options.plain &&
			!options.json &&
			!options.compact &&
			(options.format ?? 'text') === 'text' &&
			!options.ready &&
			!options.blocking;

		// When --ready is used, we need ALL tasks to correctly compute which dependencies are satisfied
		// So we fetch without status filter first, then apply status filter after ready/blocking.
		// The summary counts every task too, whatever the status filter.
		const needsAllTasks = options.ready || options.blocking || showsSummary;

		// Build filter - skip status filter if we need all tasks for ready/blocking computation
		const filter =
			statusFilterValues && !needsAllTasks
				? { status: statusFilterValues }
				: undefined;

		// Call tm-core. The summary counts subtasks even when the table hides
		// them (#246); the table only shows them with --with-subtasks.
		const result = await this.tmCore.tasks.list({
			tag: options.tag,
			filter,
			includeSubtasks: showsSummary ? true : options.withSubtasks
		});
		// The rows keep subtasks only when asked for, as before
		const listed =
			showsSummary && !options.withSubtasks
				? result.tasks.map((task) => ({ ...task, subtasks: [] }))
				: result.tasks;

		// Build blocks map and enrich tasks with blocks field. Dependencies on
		// archived tasks count as done, not as missing
		const archivedIds = await this.tmCore.tasks.getArchivedIds(options.tag);
		const { blocksMap, invalidDependencies } = buildBlocksMap(
			listed,
			archivedIds
		);
		this.displayInvalidDependencyWarnings(invalidDependencies);
		const enrichedTasks = listed.map((task) => ({
			...task,
			blocks: blocksMap.get(String(task.id)) || []
		}));

		// Apply ready/blocking filters (with full task context)
		let filteredTasks = enrichedTasks;

		if (options.ready) {
			filteredTasks = filterReadyTasks(filteredTasks, archivedIds);
		}

		if (options.blocking) {
			filteredTasks = filterBlockingTasks(filteredTasks);
		}

		// Apply status filter AFTER ready/blocking if we deferred it earlier
		if (statusFilterValues && needsAllTasks) {
			filteredTasks = filteredTasks.filter((task) =>
				statusFilterValues.includes(task.status)
			);
		}

		// The recommendation comes from tm-core so it matches `taskgraph next`.
		// It may be a subtask (`2.2`), which isn't a row of the task list, so
		// keep the object tm-core returns rather than looking the ID up (#246).
		const next = showsSummary
			? await this.tmCore.tasks.getNext(options.tag)
			: null;

		return {
			...result,
			tasks: filteredTasks,
			filtered: filteredTasks.length,
			nextTaskId: next ? String(next.id) : null,
			nextTask: next,
			// The summary's ready count treats archived dependencies as done
			...(showsSummary && {
				summaryTasks: satisfyArchivedDependencies(result.tasks, archivedIds)
			})
		} as ListTasksResult;
	}

	/**
	 * Get ready tasks from all tags
	 * Fetches tasks from each tag and combines them with tag info
	 */
	private async getTasksFromAllTags(
		options: ListCommandOptions
	): Promise<ListTasksResult> {
		if (!this.tmCore) {
			throw new Error('TmCore not initialized');
		}

		// Get all tags
		const tagsResult = await this.tmCore.tasks.getTagsWithStats();
		const allTaggedTasks: TaskWithTag[] = [];
		let totalTaskCount = 0;
		const failedTags: Array<{ name: string; error: string }> = [];

		// Fetch tasks from each tag
		for (const tagInfo of tagsResult.tags) {
			const tagName = tagInfo.name;

			try {
				// Get tasks for this tag
				const result = await this.tmCore.tasks.list({
					tag: tagName,
					includeSubtasks: options.withSubtasks
				});

				// Track total count before any filtering (consistent with getTasks)
				totalTaskCount += result.tasks.length;

				// Build blocks map for this tag's tasks
				const archivedIds = await this.tmCore.tasks.getArchivedIds(tagName);
				const { blocksMap, invalidDependencies } = buildBlocksMap(
					result.tasks,
					archivedIds
				);
				this.displayInvalidDependencyWarnings(invalidDependencies, tagName);

				// Enrich tasks with blocks field and tag name
				const enrichedTasks: TaskWithTag[] = result.tasks.map((task) => ({
					...task,
					blocks: blocksMap.get(String(task.id)) || [],
					tagName
				}));

				// Apply ready filter per-tag to respect tag-scoped dependencies
				// (task IDs may overlap between tags, so we must filter within each tag)
				const tasksToAdd: TaskWithTag[] = options.ready
					? (filterReadyTasks(enrichedTasks, archivedIds) as TaskWithTag[])
					: enrichedTasks;

				allTaggedTasks.push(...tasksToAdd);
			} catch (tagError: unknown) {
				const errorMessage =
					tagError instanceof Error ? tagError.message : String(tagError);
				failedTags.push({ name: tagName, error: errorMessage });
				continue; // Skip this tag but continue with others
			}
		}

		// Warn about failed tags
		if (failedTags.length > 0) {
			console.warn(
				chalk.yellow(
					`\nWarning: Could not fetch tasks from ${failedTags.length} tag(s):`
				)
			);
			failedTags.forEach(({ name, error }) => {
				console.warn(theme.muted(`  ${name}: ${error}`));
			});
		}

		// If ALL tags failed, throw to surface the issue
		if (
			failedTags.length === tagsResult.tags.length &&
			tagsResult.tags.length > 0
		) {
			throw new Error(
				`Failed to fetch tasks from any tag. First error: ${failedTags[0].error}`
			);
		}

		// Apply additional filters
		let filteredTasks: TaskWithTag[] = allTaggedTasks;

		// Apply blocking filter if specified
		if (options.blocking) {
			filteredTasks = filteredTasks.filter((task) => task.blocks.length > 0);
		}

		// Apply status filter if specified
		if (options.status && options.status !== 'all') {
			const statusValues = options.status
				.split(',')
				.map((s) => s.trim() as TaskStatus);
			filteredTasks = filteredTasks.filter((task) =>
				statusValues.includes(task.status)
			);
		}

		return {
			tasks: filteredTasks,
			total: totalTaskCount,
			filtered: filteredTasks.length,
			allTags: true
		};
	}

	/**
	 * Display warnings for invalid dependency references
	 * @param invalidDependencies - Array of invalid dependency references from buildBlocksMap
	 * @param tagName - Optional tag name for context in multi-tag mode
	 */
	private displayInvalidDependencyWarnings(
		invalidDependencies: InvalidDependency[],
		tagName?: string
	): void {
		if (invalidDependencies.length === 0) {
			return;
		}

		const tagContext = tagName ? ` (tag: ${tagName})` : '';
		console.warn(
			chalk.yellow(
				`\nWarning: ${invalidDependencies.length} invalid dependency reference(s) found${tagContext}:`
			)
		);
		invalidDependencies.slice(0, 5).forEach(({ taskId, depId }) => {
			console.warn(
				theme.muted(`  Task ${taskId} depends on non-existent task ${depId}`)
			);
		});
		if (invalidDependencies.length > 5) {
			console.warn(
				theme.muted(`  ...and ${invalidDependencies.length - 5} more`)
			);
		}
	}

	/**
	 * Display results based on format
	 */
	private displayResults(
		result: ListTasksResult,
		options: ListCommandOptions
	): void {
		// Resolve format: --json and --compact flags override --format option
		let format: OutputFormat = options.format || 'text';
		if (options.json) {
			format = 'json';
		} else if (options.compact) {
			format = 'compact';
		}

		switch (format) {
			case 'json':
				this.displayJson(result);
				break;

			case 'compact':
				this.displayCompact(result, options);
				break;

			case 'text':
			default:
				if (options.plain) {
					this.displayPlain(result, options);
				} else {
					this.displayText(result, options);
				}
				break;
		}
	}

	/**
	 * Display in JSON format
	 */
	private displayJson(data: ListTasksResult): void {
		printJson({
			tasks: data.tasks,
			metadata: {
				total: data.total,
				filtered: data.filtered,
				tag: data.allTags ? 'all' : data.tag,
				allTags: data.allTags || false
			}
		});
	}

	/**
	 * Display in compact format
	 */
	private displayCompact(
		data: ListTasksResult,
		options: ListCommandOptions
	): void {
		const { tasks, tag, allTags } = data;

		// Display header unless --no-header is set
		if (options.noHeader !== true) {
			displayCommandHeader({
				tag: allTags ? 'all tags' : tag || 'master',
				projectRoot: this.tmCore?.projectPath
			});
		}

		for (const task of tasks) {
			const icon = STATUS_ICONS[task.status];
			// Show tag in compact format when listing all tags (tasks are TaskWithTag[])
			const tagPrefix =
				allTags && 'tagName' in task ? theme.accent(`[${task.tagName}] `) : '';
			console.log(`${tagPrefix}${chalk.cyan(task.id)} ${icon} ${task.title}`);

			if (options.withSubtasks && task.subtasks?.length) {
				for (const subtask of task.subtasks) {
					const subIcon = STATUS_ICONS[subtask.status];
					console.log(
						`  ${theme.muted(String(subtask.id))} ${subIcon} ${theme.muted(subtask.title)}`
					);
				}
			}
		}
	}

	/**
	 * One plain line per task, for a pipe: no header, summary, table or color
	 */
	private displayPlain(
		data: ListTasksResult,
		options: ListCommandOptions
	): void {
		if (data.tasks.length === 0) {
			console.log(formatEmptyList(this.emptyListFilter(options)));
			return;
		}
		console.log(
			formatPlainTaskList(data.tasks, { withSubtasks: options.withSubtasks })
		);
	}

	/** The filter an empty list names: `No ready tasks found` */
	private emptyListFilter(options: ListCommandOptions): string | undefined {
		if (options.ready) return 'ready';
		if (options.blocking) return 'blocking';
		return options.status && options.status !== 'all'
			? options.status.split(',').join(' or ')
			: undefined;
	}

	/**
	 * Display in text format with tables
	 */
	private displayText(
		data: ListTasksResult,
		options: ListCommandOptions
	): void {
		const { tasks, tag, allTags } = data;

		// Display header unless --no-header is set
		if (options.noHeader !== true) {
			displayCommandHeader({
				tag: allTags ? 'all tags' : tag || 'master',
				projectRoot: this.tmCore?.projectPath
			});
		}

		// No tasks message
		if (tasks.length === 0) {
			console.log(formatEmptyList(this.emptyListFilter(options)));
			return;
		}

		// The summary and the next step describe the whole tag, so leave them
		// out of --ready, --blocking and --all-tags views
		const isFiltered = options.ready || options.blocking || allTags;
		if (!isFiltered) {
			console.log(formatListSummary(data.summaryTasks ?? tasks, data.nextTask));
			console.log();
		}

		// Task table
		console.log(
			ui.createTaskTable(tasks, {
				showSubtasks: options.withSubtasks,
				showDependencies: true,
				showBlocks: true, // Show which tasks this one blocks
				showComplexity: true, // Enable complexity column
				showTag: allTags // Show tag column for cross-tag listing
			})
		);

		if (!isFiltered) {
			const next = formatListNextStep(data.nextTask);
			if (next) console.log(`\n${next}`);
		}
	}

	/**
	 * Set the last result for programmatic access
	 */
	private setLastResult(result: ListTasksResult): void {
		this.lastResult = result;
	}

	/**
	 * Get the last result (for programmatic usage)
	 */
	getLastResult(): ListTasksResult | undefined {
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
	static register(program: Command, name?: string): ListTasksCommand {
		const listCommand = new ListTasksCommand(name);
		program.addCommand(listCommand);
		return listCommand;
	}
}
