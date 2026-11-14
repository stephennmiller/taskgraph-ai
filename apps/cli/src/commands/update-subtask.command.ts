/**
 * @fileoverview `taskgraph update-subtask`: the AI writes notes for a subtask
 * from your prompt and they are appended to its details, timestamped. Thin
 * layer over tm-core's tasks.updateSubtask(), which saves under the
 * tasks.json lock without dropping changes made while the AI was writing.
 */

import { createTmCore, exitOnStopSignals } from '@tm/core';
import chalk from 'chalk';
import { Command } from 'commander';
import { projectOption, tagOption } from '../utils/shared-options.js';
import type { Ora } from 'ora';
import { fit, terminalSafe } from '../ui/formatters/markdown-formatters.js';
import { formatNotesAdded } from '../ui/formatters/task-update-formatters.js';
import { formatUsageLine } from '../ui/formatters/usage-formatters.js';
import { createSpinner } from '../ui/spinner.js';
import { theme } from '../ui/theme.js';
import { displayCommandHeader } from '../utils/display-helpers.js';
import {
	aiErrorHint,
	displayError,
	printError
} from '../utils/error-handler.js';
import { pickId } from '../utils/id-argument.js';
import { getProjectRoot } from '../utils/project-root.js';
import {
	legacyFileOption,
	otherTasksFileError
} from '../utils/tasks-file-option.js';

export interface UpdateSubtaskCommandOptions {
	id?: string;
	prompt?: string;
	research?: boolean;
	file?: string;
	tag?: string;
	project?: string;
}

const EXAMPLE =
	"Try `taskgraph update-subtask 5.2 --prompt='Add more details about the API endpoint'`";

export class UpdateSubtaskCommand extends Command {
	private spinner?: Ora;

	/** Print a line; one printed while the spinner runs would be drawn over */
	private print(line: string) {
		this.spinner?.clear();
		console.log(line);
		this.spinner?.render();
	}

	constructor(name?: string) {
		super(name || 'update-subtask');

		this.description('Have the AI append a timestamped note to a subtask')
			.argument('[id]', 'Subtask ID, e.g. 3.2 (same as --id)')
			.addOption(legacyFileOption())
			.option('-i, --id <id>', 'The same as the [id] argument')
			.option('--prompt <text>', 'What to add (required)')
			.option(
				'-r, --research',
				'Use the research model, which can search the web'
			)
			.addOption(tagOption())
			.addOption(projectOption())
			.action(
				async (
					id: string | undefined,
					options: UpdateSubtaskCommandOptions
				) => {
					await exitOnStopSignals(() =>
						this.executeCommand({
							...options,
							id: pickId(id, options.id, 'update-subtask')
						})
					);
				}
			);
	}

	private async executeCommand(
		options: UpdateSubtaskCommandOptions
	): Promise<void> {
		if (!options.id) {
			printError('Missing subtask ID', EXAMPLE);
			process.exit(1);
		}
		if (!options.prompt?.trim()) {
			printError('Missing --prompt: say what to add to the subtask', EXAMPLE);
			process.exit(1);
		}
		const fileError = otherTasksFileError(
			options.file,
			'update-subtask',
			options.project
		);
		if (fileError) displayError(fileError);
		const projectRoot = getProjectRoot(options.project);

		try {
			const tmCore = await createTmCore({ projectPath: projectRoot });
			const tag = options.tag || tmCore.config.getActiveTag();
			displayCommandHeader({ tag, projectRoot });

			const result = await tmCore.tasks.updateSubtask(
				{
					id: options.id,
					prompt: options.prompt,
					research: options.research,
					tag,
					outputType: 'cli'
				},
				{
					onWarning: (message) =>
						this.print(`${chalk.yellow('⚠')} ${terminalSafe(message)}`),
					onDebug: (message) => this.print(theme.muted(terminalSafe(message))),
					onAiCall: ({ id, title, research }) => {
						this.spinner = createSpinner(
							`Updating subtask ${terminalSafe(id)}: ${fit(terminalSafe(title).replace(/\s+/g, ' '), 50)}${research ? ' (with research)' : ''}`
						).start();
					}
				}
			);
			this.stopSpinner();
			console.log(
				`\n${formatNotesAdded(
					{ kind: 'subtask', id: result.id, title: result.subtask.title },
					result.added
				)}`
			);
			const usage = formatUsageLine(result.telemetryData);
			if (usage) console.log(`\n${theme.muted(usage)}`);
		} catch (error: any) {
			this.stopSpinner();
			displayError(error, { hint: error?.hint ?? aiErrorHint(error) });
		}
	}

	private stopSpinner() {
		this.spinner?.stop();
		this.spinner = undefined;
	}

	static register(program: Command, name?: string): UpdateSubtaskCommand {
		const command = new UpdateSubtaskCommand(name);
		program.addCommand(command);
		return command;
	}
}
