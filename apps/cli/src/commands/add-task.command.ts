/**
 * @fileoverview `taskgraph add-task`: add a task, written by the AI from
 * `--prompt`, or given with `--title` and `--description` (no AI call).
 * Thin layer over tm-core's tasks.add(), which saves the task under the
 * tasks.json lock without dropping changes made while the AI was writing.
 */

import path from 'node:path';
import {
	TASKGRAPH_TASKS_FILE,
	type AddTaskResult,
	createTmCore
} from '@tm/core';
import chalk from 'chalk';
import { Command } from 'commander';
import type { Ora } from 'ora';
import { formatResearchContext } from '../ui/formatters/research-formatters.js';
import { formatTaskCreated } from '../ui/formatters/task-created-formatters.js';
import { terminalSafe } from '../ui/formatters/markdown-formatters.js';
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

export interface AddTaskCommandOptions {
	file?: string;
	prompt?: string;
	title?: string;
	description?: string;
	details?: string;
	dependencies?: string;
	discoveredFrom?: string;
	priority?: string;
	research?: boolean;
	ac?: string[];
	tag?: string;
}

/** The ✓ line, dependency rows and next step for a saved task */
function formatAdded(result: AddTaskResult): string {
	return formatTaskCreated({
		id: result.task.id,
		title: result.task.title,
		priority: result.task.priority,
		dependencies: result.dependencies,
		discoveredFrom: result.discoveredFrom
	});
}

export class AddTaskCommand extends Command {
	constructor(name?: string) {
		super(name || 'add-task');

		this.description(
			'Add a new task using AI, optionally providing manual details'
		)
			.option(
				'-f, --file <file>',
				`Path to the tasks file (only ${TASKGRAPH_TASKS_FILE})`
			)
			.option(
				'-p, --prompt <prompt>',
				'Description of the task to add (required if not using manual fields)'
			)
			.option('-t, --title <title>', 'Task title (for manual task creation)')
			.option(
				'-d, --description <description>',
				'Task description (for manual task creation)'
			)
			.option(
				'--details <details>',
				'Implementation details (for manual task creation)'
			)
			.option(
				'--dependencies <dependencies>',
				'Comma-separated list of task IDs this task depends on'
			)
			.option(
				'--discovered-from <id>',
				'Task you found this work while doing; links them without blocking'
			)
			.option(
				'--priority <priority>',
				'Task priority (high, medium, low; default: global.defaultPriority, else medium)'
			)
			.option(
				'-r, --research',
				'Whether to use research capabilities for task creation'
			)
			.option(
				'--ac <criterion>',
				'Acceptance criterion; repeat for more (set-status --check ticks them)',
				(value: string, previous: string[] = []) => [...previous, value]
			)
			.option('--tag <tag>', 'Specify tag context for task operations')
			.action(async (options: AddTaskCommandOptions) => {
				await this.executeCommand(options);
			});
	}

	private async executeCommand(options: AddTaskCommandOptions): Promise<void> {
		if (!options.prompt && !(options.title && options.description)) {
			printError(
				'Say what the task is with --prompt, or give --title and --description',
				"Example: taskgraph add-task --prompt='Add a health check endpoint'"
			);
			process.exit(1);
		}

		const projectRoot = getProjectRoot();
		// tm-core writes the project's tasks.json; any other file is refused
		if (
			options.file &&
			path.resolve(projectRoot, options.file) !==
				path.join(projectRoot, TASKGRAPH_TASKS_FILE)
		) {
			printError(
				`add-task writes only ${TASKGRAPH_TASKS_FILE}, not ${terminalSafe(options.file)}`,
				'Leave out --file, or run the command in the project that file belongs to'
			);
			process.exit(1);
		}

		let spinner: Ora | undefined;
		// A line printed while the spinner runs would be drawn over
		const print = (line: string) => {
			if (spinner?.isSpinning) {
				spinner.clear();
				console.log(line);
				spinner.render();
			} else {
				console.log(line);
			}
		};
		try {
			const tmCore = await createTmCore({ projectPath: projectRoot });
			const tag = options.tag || tmCore.config.getActiveTag();
			if (displayCommandHeader({ tag, projectRoot })) console.log();

			const result = await tmCore.tasks.add(
				{
					prompt: options.prompt,
					title: options.title,
					description: options.description,
					details: options.details,
					dependencies: options.dependencies
						?.split(',')
						.map((id) => id.trim())
						.filter(Boolean),
					discoveredFrom: options.discoveredFrom,
					priority: options.priority,
					research: options.research,
					acceptanceCriteria: options.ac,
					tag,
					outputType: 'cli'
				},
				{
					onWarning: (message) =>
						print(`${chalk.yellow('⚠')} ${terminalSafe(message)}`),
					onDebug: (message) => print(theme.muted(terminalSafe(message))),
					onAiCall: ({ dependencyIds, relatedTaskIds }) => {
						const context = formatResearchContext({
							taskIds: dependencyIds,
							relatedTaskIds,
							files: []
						});
						if (context) console.log(context);
						spinner = createSpinner(
							`Writing the new task${options.research ? ' with research' : ''}…`
						).start();
					}
				}
			);
			spinner?.stop();

			console.log(formatAdded(result));
			const usage = result.telemetryData
				? formatUsageLine(result.telemetryData)
				: '';
			if (usage) console.log(`\n${theme.muted(usage)}`);
		} catch (error: any) {
			if (spinner?.isSpinning) spinner.fail();
			displayError(error, { hint: error?.hint ?? aiErrorHint(error) });
		}
	}

	static register(program: Command, name?: string): AddTaskCommand {
		const command = new AddTaskCommand(name);
		program.addCommand(command);
		return command;
	}
}
