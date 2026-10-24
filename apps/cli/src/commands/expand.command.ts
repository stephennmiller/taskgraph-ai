/**
 * @fileoverview `taskgraph expand`: break a task (`--id`) or every pending
 * task (`--all`) into subtasks with the AI. Thin layer over tm-core's
 * tasks.expand() and tasks.expandAll(), which save under the tasks.json lock
 * without dropping changes made while the AI was writing.
 */

import path from 'node:path';
import {
	type ExpandOptions,
	type ExpandTaskHooks,
	type TmCore,
	createTmCore
} from '@tm/core';
import chalk from 'chalk';
import { Command, Option } from 'commander';
import type { Ora } from 'ora';
import {
	formatExpandAll,
	formatExpandAllProgress
} from '../ui/formatters/expand-all-formatters.js';
import { terminalSafe } from '../ui/formatters/markdown-formatters.js';
import { formatAddedSubtasks } from '../ui/formatters/subtask-summary-formatters.js';
import { formatUsageLine } from '../ui/formatters/usage-formatters.js';
import { createSpinner } from '../ui/spinner.js';
import { theme } from '../ui/theme.js';
import { displayCommandHeader } from '../utils/display-helpers.js';
import {
	aiErrorHint,
	displayError,
	printError
} from '../utils/error-handler.js';
import { getProjectRoot } from '../utils/project-root.js';
import { otherTasksFileError } from '../utils/tasks-file-option.js';

export interface ExpandCommandOptions {
	id?: string;
	all?: boolean;
	num?: string;
	research?: boolean;
	prompt?: string;
	force?: boolean;
	file?: string;
	complexityReport?: string;
	tag?: string;
}

/** The muted usage line, or nothing without usage */
function printUsage(telemetry: Parameters<typeof formatUsageLine>[0]) {
	const usage = formatUsageLine(telemetry);
	if (usage) console.log(`\n${theme.muted(usage)}`);
}

export class ExpandCommand extends Command {
	private spinner?: Ora;

	/** Print a line; one printed while the spinner runs would be drawn over */
	private print(line: string, stream: 'log' | 'error' = 'log') {
		this.spinner?.clear();
		console[stream](line);
		this.spinner?.render();
	}

	/** Warnings, and AI detail with global.debug on, as add-task prints them */
	private readonly reportHooks: ExpandTaskHooks = {
		onWarning: (message) =>
			this.print(`${chalk.yellow('⚠')} ${terminalSafe(message)}`),
		onDebug: (message) => this.print(theme.muted(terminalSafe(message)))
	};

	constructor(name?: string) {
		super(name || 'expand');

		this.description('Expand a task into subtasks using AI')
			.option('-i, --id <id>', 'ID of the task to expand')
			.option(
				'-a, --all',
				'Expand all pending tasks based on complexity analysis'
			)
			.option(
				'-n, --num <number>',
				'Number of subtasks to generate (uses complexity analysis by default if available)'
			)
			.option(
				'-r, --research',
				'Enable research-backed generation (web research via Claude Code)'
			)
			.option(
				'-p, --prompt <text>',
				'Additional context for subtask generation'
			)
			.option('-f, --force', 'Force expansion even if subtasks exist')
			// -f is --force here, so the legacy flag is --file only
			.addOption(new Option('--file <file>').hideHelp())
			.option(
				'--complexity-report <file>',
				'Path to the complexity report file (use this to specify the complexity report, not --file)'
			)
			.option('--tag <tag>', 'Specify tag context for task operations')
			.action(async (options: ExpandCommandOptions) => {
				await this.executeCommand(options);
			});
	}

	private async executeCommand(options: ExpandCommandOptions): Promise<void> {
		if (!options.all && !options.id) {
			printError(
				'Missing task ID',
				'Try `taskgraph expand --id=3`, or `--all` for every pending task'
			);
			process.exit(1);
		}

		const fileError = otherTasksFileError(options.file, 'expand');
		if (fileError) displayError(fileError);
		const projectRoot = getProjectRoot();

		try {
			const tmCore = await createTmCore({ projectPath: projectRoot });
			const tag = options.tag || tmCore.config.getActiveTag();
			displayCommandHeader({ tag, projectRoot });

			const expandOptions: ExpandOptions = {
				num: options.num,
				research: options.research,
				prompt: options.prompt,
				force: options.force,
				complexityReportPath:
					options.complexityReport &&
					path.resolve(projectRoot, options.complexityReport),
				tag,
				outputType: 'cli'
			};
			if (options.all) {
				await this.expandAll(tmCore, expandOptions);
				return;
			}

			const result = await tmCore.tasks.expand(
				{ ...expandOptions, id: options.id as string },
				{
					...this.reportHooks,
					onAiCall: ({ taskId, subtaskCount }) => {
						this.spinner = createSpinner(
							`Breaking task ${terminalSafe(taskId)} into ${subtaskCount || 'a few'} subtasks…`
						).start();
					}
				}
			);
			this.stopSpinner();
			if (result.skipped) {
				console.log(
					`\nTask ${terminalSafe(result.task.id)} needs no subtasks, per the complexity report\n${theme.muted('Add ')}${theme.brand('--num=<n>')}${theme.muted(' to expand it anyway')}`
				);
				return;
			}
			console.log(
				`\n${formatAddedSubtasks(result.task.id, result.addedSubtasks)}`
			);
			printUsage(result.telemetryData);
		} catch (error: any) {
			this.stopSpinner();
			displayError(error, { hint: error?.hint ?? aiErrorHint(error) });
		}
	}

	/** One spinner for the run; each task's result prints above it as it ends */
	private async expandAll(
		tmCore: TmCore,
		options: ExpandOptions
	): Promise<void> {
		let ticker: NodeJS.Timeout | undefined;
		let total = 0;
		let finished = 0;
		const started = Date.now();
		const progress = () =>
			formatExpandAllProgress({
				total,
				done: finished,
				elapsedMs: Date.now() - started
			});

		try {
			const result = await tmCore.tasks.expandAll(options, {
				...this.reportHooks,
				onStart: (ids) => {
					total = ids.length;
					this.spinner = createSpinner(progress()).start();
					ticker = setInterval(() => {
						if (this.spinner) this.spinner.text = progress();
					}, 1000);
				},
				onTaskDone: (id, outcome) => {
					finished++;
					if (outcome instanceof Error) {
						this.print(
							`${chalk.red('✗')} Couldn't expand task ${terminalSafe(id)}: ${terminalSafe(outcome.message)}`,
							'error'
						);
					} else if (!outcome.skipped) {
						this.print(`\n${formatAddedSubtasks(id, outcome.addedSubtasks)}`);
					}
					if (this.spinner) this.spinner.text = progress();
				}
			});
			clearInterval(ticker);
			this.stopSpinner();

			console.log(
				`${result.tasksToExpand > 0 ? '\n' : ''}${formatExpandAll(result)}`
			);
			printUsage(result.telemetryData);
			// The work that succeeded is saved, but the run didn't do all it was asked
			if (result.failedCount > 0) process.exitCode = 1;
		} finally {
			clearInterval(ticker);
			this.stopSpinner();
		}
	}

	private stopSpinner() {
		this.spinner?.stop();
		this.spinner = undefined;
	}

	static register(program: Command, name?: string): ExpandCommand {
		const command = new ExpandCommand(name);
		program.addCommand(command);
		return command;
	}
}
