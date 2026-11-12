/**
 * @fileoverview `taskgraph add-task`: add a task, given as a title
 * (`add-task 'Fix the login bug'`, no AI call) or written by the AI from
 * `--prompt`.
 * Thin layer over tm-core's tasks.add(), which saves the task under the
 * tasks.json lock without dropping changes made while the AI was writing.
 */

import { type AddTaskResult, createTmCore, exitOnStopSignals } from '@tm/core';
import chalk from 'chalk';
import { Command } from 'commander';
import { projectOption, tagOption } from '../utils/shared-options.js';
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
import { pickValue } from '../utils/id-argument.js';
import { getProjectRoot } from '../utils/project-root.js';
import {
	legacyFileOption,
	otherTasksFileError
} from '../utils/tasks-file-option.js';

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
	assignee?: string;
	tag?: string;
	project?: string;
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

		this.description('Add a task; --prompt has the AI write it')
			.argument('[title...]', 'Task title, saved as written (no AI call)')
			.addOption(legacyFileOption())
			.option(
				'--prompt <prompt>',
				'What the task should do; the AI writes the title and description'
			)
			.option('-t, --title <title>', 'The same as the [title] argument')
			.option('-d, --description <description>', 'Task description')
			.option('--details <details>', 'Implementation details')
			.option(
				'--dependencies <dependencies>',
				'Tasks this one depends on, comma separated'
			)
			.option(
				'--discovered-from <id>',
				'Task you found this work while doing; links them without blocking'
			)
			.option(
				'--priority <priority>',
				'high, medium or low (default medium, unless your config sets one)'
			)
			.option(
				'-r, --research',
				'With --prompt: use the research model, which can search the web'
			)
			.option(
				'--ac <criterion>',
				'An acceptance criterion; repeat for more (set-status --check ticks them)',
				(value: string, previous: string[] = []) => [...previous, value]
			)
			.option('--assignee <login>', 'GitHub login of who the task is for')
			.addOption(tagOption())
			.addOption(projectOption())
			.action(async (words: string[], options: AddTaskCommandOptions) => {
				const title = pickValue(
					words.join(' ') || undefined,
					options.title,
					{ name: 'the title', flag: '--title' },
					'add-task'
				);
				await exitOnStopSignals(() =>
					this.executeCommand({ ...options, title })
				);
			});
	}

	private async executeCommand(options: AddTaskCommandOptions): Promise<void> {
		if (!options.prompt && !options.title?.trim()) {
			printError(
				'add-task needs a title, or --prompt for the AI to write the task',
				"Try `taskgraph add-task 'Fix the login bug'`"
			);
			process.exit(1);
		}

		const fileError = otherTasksFileError(
			options.file,
			'add-task',
			options.project
		);
		if (fileError) displayError(fileError);
		const projectRoot = getProjectRoot(options.project);

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
					assignee: options.assignee,
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
