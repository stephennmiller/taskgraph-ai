/**
 * @fileoverview NextCommand using Commander's native class pattern
 * Extends Commander.Command for better integration with the framework
 */

import path from 'node:path';
import { type Task, type TaskClaim, type TmCore, createTmCore } from '@tm/core';
import boxen from 'boxen';
import chalk from 'chalk';
import { Command } from 'commander';
import { displayTaskDetails } from '../ui/components/task-detail.component.js';
import { formatClaim } from '../ui/formatters/claim-formatters.js';
import { displayCommandHeader } from '../utils/display-helpers.js';
import { displayError } from '../utils/error-handler.js';
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

		return {
			task,
			found: task !== null,
			tag: activeTag,
			hasAnyTasks
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
			console.log(JSON.stringify(result, null, 2));
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
		console.log(JSON.stringify(result, null, 2));
	}

	/**
	 * Display in text format
	 */
	private displayText(result: NextTaskResult): void {
		displayCommandHeader({ tag: result.tag || 'master' });

		if (!result.found || !result.task) {
			// Only show warning box if there are literally NO tasks at all
			if (!result.hasAnyTasks) {
				console.log(
					boxen(chalk.yellow('No tasks found in this project.'), {
						padding: 1,
						borderStyle: 'round',
						borderColor: 'yellow',
						title: 'No tasks available',
						titleAlignment: 'center'
					})
				);
				console.log(
					`\n${chalk.dim('Tip: Create tasks with')} ${chalk.cyan('taskgraph parse-prd')} ${chalk.dim('or')} ${chalk.cyan('taskgraph add-task')}`
				);
			} else {
				// Tasks exist but none are available to work on - just show a simple message
				console.log(
					chalk.yellow(
						'✓ All tasks are either completed, blocked by dependencies, or in progress.'
					)
				);
				console.log(
					`\n${chalk.dim('Tip: Try')} ${chalk.cyan('taskgraph list')} ${chalk.dim('to see all tasks')}`
				);
			}
			return;
		}

		const task = result.task;

		// Display the task details using the same component as 'show' command
		// with a custom header indicating this is the next task
		const customHeader = `Next Task: #${task.id} - ${task.title}`;
		displayTaskDetails(task, {
			customHeader,
			headerColor: 'green',
			showSuggestedActions: true
		});
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
