/**
 * @fileoverview `taskgraph add-subtask`: add a subtask to a task, or with
 * --task-id turn a task into one. Thin layer over tm-core's
 * tasks.addSubtask().
 */

import { createTmCore } from '@tm/core';
import { Command, Option } from 'commander';
import { projectOption, tagOption } from '../utils/shared-options.js';
import { formatSubtaskAdded } from '../ui/formatters/subtask-change-formatters.js';
import { terminalSafe } from '../ui/formatters/markdown-formatters.js';
import { displayError, printError } from '../utils/error-handler.js';
import { pickValue } from '../utils/id-argument.js';
import { getProjectRoot } from '../utils/project-root.js';
import {
	legacyFileOption,
	otherTasksFileError
} from '../utils/tasks-file-option.js';

interface AddSubtaskOptions {
	parent?: string;
	taskId?: string;
	title?: string;
	description?: string;
	details?: string;
	dependencies?: string;
	status?: string;
	tag?: string;
	project?: string;
	file?: string;
}

export class AddSubtaskCommand extends Command {
	constructor(name?: string) {
		super(name || 'add-subtask');

		this.description('Add a subtask, or make a task one')
			.argument('[parent]', 'Task to add the subtask to')
			.option('--parent <id>', 'The same as the [parent] argument')
			.option('-i, --task-id <id>', 'Make this existing task the subtask')
			.option('-t, --title <title>', 'Title of the new subtask')
			.option('-d, --description <text>', 'Description of the new subtask')
			.option('--details <text>', 'Implementation details of the new subtask')
			.option(
				'--dependencies <ids>',
				'Tasks or subtasks the new subtask depends on, comma separated (3,5.2)'
			)
			.option('-s, --status <status>', 'Status of the new subtask', 'pending')
			.addOption(tagOption())
			.addOption(projectOption())
			.addOption(legacyFileOption())
			// Task files are written by `generate`; the old flag already did nothing
			.addOption(new Option('--generate').hideHelp())
			.action((parent: string | undefined, options: AddSubtaskOptions) =>
				this.execute({
					...options,
					parent: pickValue(
						parent,
						options.parent,
						{ name: 'the parent', flag: '--parent' },
						'add-subtask'
					)
				})
			);
	}

	private async execute(options: AddSubtaskOptions): Promise<void> {
		const fileError = otherTasksFileError(
			options.file,
			'add-subtask and move',
			options.project
		);
		if (fileError) displayError(fileError);
		const parentId = options.parent;
		if (!parentId) {
			printError(
				'add-subtask needs the task to add the subtask to',
				"Try `taskgraph add-subtask 5 --title='<title>'`"
			);
			process.exit(1);
		}
		if (!options.taskId && !options.title) {
			printError(
				'add-subtask needs --title for a new subtask, or --task-id to move a task',
				`Try \`taskgraph add-subtask ${terminalSafe(parentId)} --title='<title>'\` or \`--task-id=<id>\``
			);
			process.exit(1);
		}

		try {
			const tmCore = await createTmCore({
				projectPath: getProjectRoot(options.project)
			});
			const { subtask } = await tmCore.tasks.addSubtask(
				parentId,
				options.taskId
					? { fromTaskId: options.taskId }
					: {
							title: options.title,
							description: options.description,
							details: options.details,
							status: options.status,
							dependencies: options.dependencies
						},
				{ tag: options.tag }
			);
			console.log(formatSubtaskAdded(parentId, subtask, options.taskId));
		} catch (error) {
			displayError(error);
		}
	}

	static register(program: Command, name?: string): AddSubtaskCommand {
		const command = new AddSubtaskCommand(name);
		program.addCommand(command);
		return command;
	}
}
