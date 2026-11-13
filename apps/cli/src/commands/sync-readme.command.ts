/**
 * @fileoverview `taskgraph sync-readme`: write the tag's task list into the
 * project's README.md through tm-core's tasks.syncReadme()
 */

import { createTmCore } from '@tm/core';
import { Command } from 'commander';
import { projectOption, tagOption } from '../utils/shared-options.js';
import { formatReadmeSync } from '../ui/formatters/readme-sync-formatters.js';
import { displayError } from '../utils/error-handler.js';
import { getProjectRoot } from '../utils/project-root.js';
import {
	legacyFileOption,
	otherTasksFileError
} from '../utils/tasks-file-option.js';

export interface SyncReadmeCommandOptions {
	file?: string;
	withSubtasks?: boolean;
	status?: string;
	tag?: string;
	project?: string;
}

export class SyncReadmeCommand extends Command {
	constructor(name?: string) {
		super(name || 'sync-readme');

		this.description('Export tasks to README.md')
			.addOption(legacyFileOption())
			.option('--with-subtasks', 'Include subtasks')
			.option('-s, --status <status>', 'Only tasks with this status')
			.addOption(tagOption())
			.addOption(projectOption())
			.action(async (options: SyncReadmeCommandOptions) => {
				await this.executeCommand(options);
			});
	}

	private async executeCommand(
		options: SyncReadmeCommandOptions
	): Promise<void> {
		const fileError = otherTasksFileError(
			options.file,
			'sync-readme',
			options.project
		);
		if (fileError) displayError(fileError);
		try {
			const tmCore = await createTmCore({
				projectPath: getProjectRoot(options.project)
			});
			await tmCore.tasks.syncReadme({
				withSubtasks: Boolean(options.withSubtasks),
				status: options.status,
				tag: options.tag
			});
		} catch (error: unknown) {
			displayError(error);
			return;
		}
		console.log(formatReadmeSync(options));
	}

	static register(program: Command, name?: string): SyncReadmeCommand {
		const command = new SyncReadmeCommand(name);
		program.addCommand(command);
		return command;
	}
}
