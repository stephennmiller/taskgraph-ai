/**
 * @fileoverview `taskgraph update-task` (rewrite one task with the AI, or
 * with --append add the AI's notes to it) and `taskgraph update --from`
 * (rewrite every unfinished task from an ID on). Thin layer over tm-core's
 * tasks.updateWithPrompt() and tasks.updateFrom(), which save under the
 * tasks.json lock without dropping changes made while the AI was writing.
 */

import { type UpdateHooks, createTmCore } from '@tm/core';
import chalk from 'chalk';
import { Command, Option } from 'commander';
import type { Ora } from 'ora';
import { truncate } from '../ui/layout/helpers.js';
import { terminalSafe } from '../ui/formatters/markdown-formatters.js';
import {
	formatAssigned,
	formatNotesAdded,
	formatNothingToUpdate,
	formatTasksUpdated,
	formatTaskUpdated
} from '../ui/formatters/task-update-formatters.js';
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
import {
	legacyFileOption,
	otherTasksFileError
} from '../utils/tasks-file-option.js';

interface CommonOptions {
	file?: string;
	prompt?: string;
	research?: boolean;
	tag?: string;
}

export interface UpdateTaskCommandOptions extends CommonOptions {
	id?: string;
	append?: boolean;
	assignee?: string;
}

export interface UpdateCommandOptions extends CommonOptions {
	from: string;
	/** A common mistake: update takes --from */
	id?: string;
}

/** The muted usage line, or nothing without usage */
function printUsage(telemetry: Parameters<typeof formatUsageLine>[0]) {
	const usage = formatUsageLine(telemetry);
	if (usage) console.log(`\n${theme.muted(usage)}`);
}

/**
 * Run one update: the header, a spinner while the AI writes, warnings above
 * it, and the error printed once
 */
async function runUpdate(
	command: string,
	options: CommonOptions,
	work: (
		tmCore: Awaited<ReturnType<typeof createTmCore>>,
		tag: string,
		hooks: UpdateHooks & { startSpinner: (text: string) => void },
		stopSpinner: () => void
	) => Promise<void>
): Promise<void> {
	const fileError = otherTasksFileError(options.file, command);
	if (fileError) displayError(fileError);
	const projectRoot = getProjectRoot();
	let spinner: Ora | undefined;
	// A line printed while the spinner runs would be drawn over
	const print = (line: string) => {
		spinner?.clear();
		console.log(line);
		spinner?.render();
	};
	const stopSpinner = () => {
		spinner?.stop();
		spinner = undefined;
	};
	try {
		const tmCore = await createTmCore({ projectPath: projectRoot });
		const tag = options.tag || tmCore.config.getActiveTag();
		displayCommandHeader({ tag, projectRoot });
		await work(
			tmCore,
			tag,
			{
				onWarning: (message) =>
					print(`${chalk.yellow('⚠')} ${terminalSafe(message)}`),
				onDebug: (message) => print(theme.muted(terminalSafe(message))),
				startSpinner: (text) => {
					spinner = createSpinner(text).start();
				}
			},
			stopSpinner
		);
	} catch (error: any) {
		stopSpinner();
		displayError(error, { hint: error?.hint ?? aiErrorHint(error) });
	}
}

export class UpdateTaskCommand extends Command {
	constructor(name?: string) {
		super(name || 'update-task');

		this.description('Update a single specific task by ID with new information')
			.argument('[id]', 'Task ID to update (e.g., 1, 1.1, TAS-123)')
			.argument(
				'[prompt...]',
				'Update prompt - multiple words, no quotes needed'
			)
			.addOption(legacyFileOption())
			.option(
				'-i, --id <id>',
				'Task ID to update (fallback if not using positional)'
			)
			.option(
				'-p, --prompt <text>',
				'Prompt (fallback if not using positional)'
			)
			.option(
				'-r, --research',
				'Use Claude Code web research for research-backed task updates'
			)
			.option(
				'--append',
				'Append timestamped information to task details instead of full update'
			)
			.option(
				'--assignee <login>',
				"GitHub login of who the task is for ('' clears it); no prompt needed"
			)
			.option('--tag <tag>', 'Specify tag context for task operations')
			.action(
				async (
					idArg: string | undefined,
					promptWords: string[],
					options: UpdateTaskCommandOptions
				) => {
					const id = idArg || options.id;
					const prompt =
						promptWords.length > 0 ? promptWords.join(' ') : options.prompt;
					await this.executeCommand(id, prompt, options);
				}
			);
	}

	private async executeCommand(
		id: string | undefined,
		prompt: string | undefined,
		options: UpdateTaskCommandOptions
	): Promise<void> {
		if (!id) {
			printError(
				'Missing task ID',
				'Try `taskgraph update-task --id=3 --prompt="what changed"`'
			);
			process.exit(1);
		}
		const { assignee } = options;
		if (!prompt && assignee === undefined) {
			printError(
				'Missing prompt',
				`Try \`taskgraph update-task --id=${terminalSafe(id)} --prompt="what changed"\``
			);
			process.exit(1);
		}

		await runUpdate(
			'update-task',
			options,
			async (tmCore, tag, hooks, stop) => {
				if (assignee !== undefined) {
					const assigned = await tmCore.tasks.assign(id, assignee, tag);
					console.log(
						formatAssigned({ id, title: assigned.title }, assigned.assignee)
					);
				}
				if (!prompt) return;
				const result = await tmCore.tasks.updateWithPrompt(
					{
						id,
						prompt,
						research: options.research,
						append: options.append,
						tag,
						outputType: 'cli'
					},
					{
						...hooks,
						onAiCall: ([task]) =>
							hooks.startSpinner(
								`Updating task ${terminalSafe(task.id)}: ${truncate(terminalSafe(task.title), 50)}${options.research ? ' (with research)' : ''}`
							)
					}
				);
				stop();
				const { task } = result;
				if (result.skipped === 'done') {
					printError(
						`Task ${terminalSafe(task.id)} is done, so it can't be updated`,
						`Run \`taskgraph set-status --id=${terminalSafe(task.id)} --status=pending\` first`
					);
					process.exitCode = 1;
					return;
				}
				console.log(
					options.append
						? formatNotesAdded(
								{ kind: 'task', id: task.id, title: task.title },
								result.appended ?? ''
							)
						: formatTaskUpdated(task)
				);
				printUsage(result.telemetryData);
			}
		);
	}

	static register(program: Command, name?: string): UpdateTaskCommand {
		const command = new UpdateTaskCommand(name);
		program.addCommand(command);
		return command;
	}
}

export class UpdateCommand extends Command {
	constructor(name?: string) {
		super(name || 'update');

		this.description(
			'Update multiple tasks with ID >= "from" based on new information or implementation changes'
		)
			.addOption(legacyFileOption())
			.option(
				'--from <id>',
				'Task ID to start updating from (tasks with ID >= this value will be updated)',
				'1'
			)
			.option(
				'-p, --prompt <text>',
				'Prompt explaining the changes or new context (required)'
			)
			.option(
				'-r, --research',
				'Use Claude Code web research for research-backed task updates'
			)
			.option('--tag <tag>', 'Specify tag context for task operations')
			.addOption(new Option('-i, --id <id>').hideHelp())
			.action(async (options: UpdateCommandOptions) => {
				await this.executeCommand(options);
			});
	}

	private async executeCommand(options: UpdateCommandOptions): Promise<void> {
		if (options.id !== undefined) {
			printError(
				'The update command uses --from=<id>, not --id=<id>',
				"To update one task, run `taskgraph update-task --id=<id> --prompt='...'`"
			);
			process.exit(1);
		}
		if (!options.prompt) {
			printError(
				'Missing prompt',
				`Try \`taskgraph update --from=${terminalSafe(options.from)} --prompt="what changed"\``
			);
			process.exit(1);
		}

		await runUpdate('update', options, async (tmCore, tag, hooks, stop) => {
			const result = await tmCore.tasks.updateFrom(
				{
					from: options.from,
					prompt: options.prompt as string,
					research: options.research,
					tag,
					outputType: 'cli'
				},
				{
					...hooks,
					onAiCall: (tasks) =>
						hooks.startSpinner(
							`Updating ${tasks.length} ${tasks.length === 1 ? 'task' : 'tasks'} from ID ${terminalSafe(options.from)}${options.research ? ' (with research)' : ''}…`
						)
				}
			);
			stop();
			if (result.sentCount === 0) {
				console.log(formatNothingToUpdate(terminalSafe(options.from)));
				return;
			}
			console.log(formatTasksUpdated(result.updatedTasks));
			printUsage(result.telemetryData);
			// Tasks were sent and none changed: the AI returned none of them
			if (result.updatedTasks.length === 0) process.exitCode = 1;
		});
	}

	static register(program: Command, name?: string): UpdateCommand {
		const command = new UpdateCommand(name);
		program.addCommand(command);
		return command;
	}
}
