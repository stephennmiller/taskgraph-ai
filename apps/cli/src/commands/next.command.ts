/**
 * @fileoverview NextCommand using Commander's native class pattern
 * Extends Commander.Command for better integration with the framework
 */

import path from 'node:path';
import {
	type Task,
	type TaskChecklist,
	type TaskClaim,
	type TmCore,
	createTmCore,
	withFullSubtaskIds
} from '@tm/core';
import { Command } from 'commander';
import { formatClaim } from '../ui/formatters/claim-formatters.js';
import { formatTaskDetail } from '../ui/formatters/task-detail-formatters.js';
import { formatNoNextTask } from '../ui/formatters/task-list-formatters.js';
import { displayCommandHeader } from '../utils/display-helpers.js';
import { displayError } from '../utils/error-handler.js';
import { jsonOption, printJson } from '../utils/json-output.js';
import { getProjectRoot } from '../utils/project-root.js';

/**
 * Options interface for the next command
 */
export interface NextCommandOptions {
	tag?: string;
	format?: 'text' | 'json';
	silent?: boolean;
	project?: string;
	claim?: boolean;
}

/**
 * Result of `next --claim`
 */
export interface ClaimNextResult {
	claimed: boolean;
	task: Task | null;
	claimedBy: string | null;
	claimedAt: string | null;
	tag: string;
	hasAnyTasks: boolean;
}

/**
 * Result type from next command
 */
export interface NextTaskResult {
	task: Task | null;
	found: boolean;
	tag: string;
	hasAnyTasks?: boolean;
	/** The task's acceptance criteria and Definition of Done, numbered for --check */
	checklist?: TaskChecklist;
}

/**
 * NextCommand extending Commander's Command class
 * This is a thin presentation layer over @tm/core
 */
export class NextCommand extends Command {
	private tmCore?: TmCore;
	private lastResult?: NextTaskResult;

	constructor(name?: string) {
		super(name || 'next');

		// Configure the command
		this.description('Find the next available task to work on')
			.option('-t, --tag <tag>', 'Filter by tag')
			.option('-f, --format <format>', 'Output format (text, json)', 'text')
			.addOption(jsonOption())
			.option(
				'--claim',
				'Start the next task and record who took it, in one locked write'
			)
			.option('--silent', 'Suppress output (useful for programmatic usage)')
			.option(
				'-p, --project <path>',
				'Project root directory (auto-detected if not provided)'
			)
			.action(async (options: NextCommandOptions) => {
				await this.executeCommand(options);
			});
	}

	/**
	 * Execute the next command
	 */
	private async executeCommand(options: NextCommandOptions): Promise<void> {
		let hasError = false;
		try {
			// Validate options (throws on invalid options)
			this.validateOptions(options);

			// Initialize tm-core
			await this.initializeCore(getProjectRoot(options.project));

			if (options.claim) {
				const claimResult = await this.claimNextTask(options);
				if (!options.silent) this.displayClaim(claimResult, options);
				return;
			}

			// Get next task from core
			const result = await this.getNextTask(options);

			// Store result for programmatic access
			this.setLastResult(result);

			// Display results
			if (!options.silent) {
				this.displayResults(result, options);
			}
		} catch (error: any) {
			hasError = true;
			displayError(error, { skipExit: true });
		} finally {
			// Always clean up resources, even on error
			await this.cleanup();
		}

		// Exit after cleanup completes
		if (hasError) {
			process.exit(1);
		}
	}

	/**
	 * Validate command options
	 */
	private validateOptions(options: NextCommandOptions): void {
		// Validate format
		if (options.format && !['text', 'json'].includes(options.format)) {
			throw new Error(
				`Invalid format: ${options.format}. Valid formats are: text, json`
			);
		}
	}

	/**
	 * Initialize TmCore
	 */
	private async initializeCore(projectRoot: string): Promise<void> {
		if (!this.tmCore) {
			const resolved = path.resolve(projectRoot);
			this.tmCore = await createTmCore({ projectPath: resolved });
		}
	}

	/**
	 * Get next task from tm-core
	 */
	private async getNextTask(
		options: NextCommandOptions
	): Promise<NextTaskResult> {
		if (!this.tmCore) {
			throw new Error('TmCore not initialized');
		}

		// Call tm-core to get next task
		const task = await this.tmCore.tasks.getNext(options.tag);

		const activeTag = options.tag || this.tmCore.config.getActiveTag();

		// Check if there are ANY tasks at all
		const allTasks = await this.tmCore.tasks.list({ tag: options.tag });
		const hasAnyTasks = allTasks && allTasks.tasks.length > 0;

		// getNext leaves the criteria out; read the checklist as stored
		const checklist = task
			? await this.tmCore.tasks.loadChecklist(String(task.id), options.tag)
			: undefined;

		return {
			task,
			found: task !== null,
			tag: activeTag,
			hasAnyTasks,
			...(checklist && { checklist })
		};
	}

	/**
	 * Claim the next task through tm-core
	 */
	private async claimNextTask(
		options: NextCommandOptions
	): Promise<ClaimNextResult> {
		if (!this.tmCore) {
			throw new Error('TmCore not initialized');
		}

		const claim: TaskClaim | null = await this.tmCore.tasks.claimNext({
			tag: options.tag
		});
		const tag = options.tag || this.tmCore.config.getActiveTag();
		const hasAnyTasks = claim
			? true
			: (await this.tmCore.tasks.list({ tag: options.tag })).tasks.length > 0;

		return {
			claimed: claim !== null,
			task: claim?.task ?? null,
			claimedBy: claim?.claimedBy ?? null,
			claimedAt: claim?.claimedAt ?? null,
			tag,
			hasAnyTasks
		};
	}

	/**
	 * Display the claim: JSON, or a few lines of text
	 */
	private displayClaim(
		result: ClaimNextResult,
		options: NextCommandOptions
	): void {
		if (options.format === 'json') {
			printJson({
				...result,
				task: withFullSubtaskIds(result.task)
			});
			return;
		}
		console.log(
			formatClaim(
				result.task && result.claimedBy
					? {
							taskId: String(result.task.id),
							title: result.task.title,
							claimedBy: result.claimedBy
						}
					: null,
				{
					hasAnyTasks: result.hasAnyTasks,
					width: process.stdout.columns || 80
				}
			)
		);
	}

	/**
	 * Display results based on format
	 */
	private displayResults(
		result: NextTaskResult,
		options: NextCommandOptions
	): void {
		const format = options.format || 'text';

		switch (format) {
			case 'json':
				this.displayJson(result);
				break;

			case 'text':
			default:
				this.displayText(result);
				break;
		}
	}

	/**
	 * Display in JSON format
	 */
	private displayJson(result: NextTaskResult): void {
		printJson({
			...result,
			task: withFullSubtaskIds(result.task)
		});
	}

	/**
	 * Display in text format
	 */
	private displayText(result: NextTaskResult): void {
		const headerShown = displayCommandHeader({
			tag: result.tag || 'master',
			projectRoot: this.tmCore?.projectPath
		});

		// Separate the tag line from the task; with no tag line, start with it
		if (headerShown) console.log();

		if (!result.found || !result.task) {
			console.log(formatNoNextTask(Boolean(result.hasAnyTasks)));
			return;
		}

		console.log(
			formatTaskDetail(result.task, {
				id: String(result.task.id),
				checklist: result.checklist
			})
		);
	}

	/**
	 * Set the last result for programmatic access
	 */
	private setLastResult(result: NextTaskResult): void {
		this.lastResult = result;
	}

	/**
	 * Get the last result (for programmatic usage)
	 */
	getLastResult(): NextTaskResult | undefined {
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
	static register(program: Command, name?: string): NextCommand {
		const nextCommand = new NextCommand(name);
		program.addCommand(nextCommand);
		return nextCommand;
	}
}
