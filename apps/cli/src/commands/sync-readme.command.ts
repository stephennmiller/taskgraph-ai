/**
 * @fileoverview `taskgraph sync-readme`: write the tag's task list into the
 * project's README.md through tm-core's tasks.syncReadme()
 */

import { createTmCore } from '@tm/core';
import { Command } from 'commander';
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
}

export class SyncReadmeCommand extends Command {
	constructor(name?: string) {
		super(name || 'sync-readme');

		this.description(
			'Sync the current task list to README.md in the project root'
		)
			.addOption(legacyFileOption())
			.option('--with-subtasks', 'Include subtasks in the README output')
			.option(
				'-s, --status <status>',
				'Show only tasks matching this status (e.g., pending, done)'
			)
			.option(
				'-t, --tag <tag>',
				'Tag to use for the task list (default: master)'
			)
			.action(async (options: SyncReadmeCommandOptions) => {
				await this.executeCommand(options);
			});
	}

	private async executeCommand(
		options: SyncReadmeCommandOptions
	): Promise<void> {
		const fileError = otherTasksFileError(options.file, 'sync-readme');
		if (fileError) displayError(fileError);
		try {
			const tmCore = await createTmCore({ projectPath: getProjectRoot() });
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
