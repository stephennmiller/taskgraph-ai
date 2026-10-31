/**
 * @fileoverview `taskgraph prime`: session context for coding agents
 * Thin presentation layer over tm-core's tasks.getPrimeContext(). The Claude
 * Code plugin's SessionStart hook runs it, so an agent starts each session
 * (and resumes after compaction) knowing the task in progress, what's ready
 * next, and the workflow rules.
 */

import path from 'node:path';
import {
	type TmCore,
	checkCliForPlugin,
	createTmCore,
	findUnmetCriteria,
	neutralizeTaskData
} from '@tm/core';
import { Command, Option } from 'commander';
import {
	formatCliTooOldForPlugin,
	formatCurrentTask,
	formatPrimeContext,
	formatUnmetCriteria,
	formatUnnotedReminder
} from '../ui/formatters/prime-formatters.js';
import { displayError } from '../utils/error-handler.js';
import { printJson } from '../utils/json-output.js';
import { getProjectRoot } from '../utils/project-root.js';

export interface PrimeCommandOptions {
	tag?: string;
	json?: boolean;
	project?: string;
	unnotedSince?: string;
	current?: boolean;
	unmetCriteria?: boolean;
	pluginRoot?: string;
}

export class PrimeCommand extends Command {
	private tmCore?: TmCore;

	constructor(name?: string) {
		super(name || 'prime');

		this.description('Print task context and workflow rules for a coding agent')
			.option('-t, --tag <tag>', 'Use a specific tag')
			.option('--json', 'Output JSON')
			.option(
				'-p, --project <path>',
				'Project root directory (auto-detected if not provided)'
			)
			.option(
				'--unnoted-since <time>',
				'Only list in-progress tasks with no note since <time> (ISO)'
			)
			// Text for the plugin's UserPromptSubmit and Stop hooks; nothing when
			// nothing applies
			.addOption(
				new Option(
					'--current',
					'Only the task in progress and its unchecked criteria'
				).conflicts(['json', 'unnotedSince', 'unmetCriteria'])
			)
			.addOption(
				new Option(
					'--unmet-criteria',
					'Only in-progress tasks with unchecked acceptance criteria'
				).conflicts(['json', 'unnotedSince'])
			)
			// The plugin's SessionStart hook passes its folder, so prime can say
			// when this CLI is older than the plugin needs. A CLI that predates
			// the option fails on it, which the hook reports the same way.
			.addOption(
				new Option(
					'--plugin-root <dir>',
					'Say if this CLI is older than the plugin in <dir> needs'
				).hideHelp()
			)
			.action(async (options: PrimeCommandOptions) => {
				await this.executeCommand(options);
			});
	}

	private async executeCommand(options: PrimeCommandOptions): Promise<void> {
		// The program's requireProject hook has already checked this is a project
		const projectRoot = path.resolve(getProjectRoot(options.project));
		let hasError = false;
		try {
			this.tmCore = await createTmCore({ projectPath: projectRoot });
			if (options.unnotedSince !== undefined) {
				const unnoted = await this.tmCore.tasks.getUnnotedInProgress({
					since: options.unnotedSince,
					tag: options.tag
				});
				if (options.json) {
					printJson({ unnoted: neutralizeTaskData(unnoted) });
				} else if (unnoted.length > 0) {
					console.log(formatUnnotedReminder(unnoted));
				}
				return;
			}
			if (options.current || options.unmetCriteria) {
				const { inProgress } = await this.tmCore.tasks.getPrimeContext({
					tag: options.tag
				});
				const text = options.current
					? formatCurrentTask(inProgress)
					: formatUnmetCriteria(findUnmetCriteria(inProgress));
				if (text) console.log(text);
				return;
			}
			// Say it before reading the tasks, so it shows even if that fails
			if (options.pluginRoot && !options.json) {
				const plugin = checkCliForPlugin(options.pluginRoot);
				if (!plugin.ok) console.log(`${formatCliTooOldForPlugin(plugin)}\n`);
			}
			const context = await this.tmCore.tasks.getPrimeContext({
				tag: options.tag
			});
			if (options.json) {
				// Titles and done-when text: none can close a fence an agent reads
				printJson(neutralizeTaskData(context));
				return;
			}
			console.log(formatPrimeContext(context));
		} catch (error: any) {
			hasError = true;
			displayError(error, { skipExit: true });
		} finally {
			this.tmCore = undefined;
		}
		if (hasError) process.exit(1);
	}

	static register(program: Command, name?: string): PrimeCommand {
		const command = new PrimeCommand(name);
		program.addCommand(command);
		return command;
	}
}
