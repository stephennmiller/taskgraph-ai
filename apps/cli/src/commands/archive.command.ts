/**
 * @fileoverview `taskgraph archive`: move finished tasks out of tasks.json,
 * and `taskgraph archive restore <id>` to bring one back.
 * Thin presentation layer over tm-core's tasks.archive() and tasks.restore()
 */

import path from 'node:path';
import { type TmCore, createTmCore, neutralizeTaskData } from '@tm/core';
import { Command } from 'commander';
import {
	formatArchiveResult,
	formatRestoreResult
} from '../ui/formatters/archive-formatters.js';
import { terminalWidth } from '../ui/layout/helpers.js';
import { displayError, printError } from '../utils/error-handler.js';
import { jsonOption, printJson } from '../utils/json-output.js';
import { getProjectRoot } from '../utils/project-root.js';

export interface ArchiveCommandOptions {
	olderThan?: string;
	dryRun?: boolean;
	tag?: string;
	format?: 'text' | 'json';
	project?: string;
}

export interface RestoreCommandOptions {
	tag?: string;
	format?: 'text' | 'json';
	project?: string;
}

const checkFormat = (format?: string) => {
	if (format && !['text', 'json'].includes(format)) {
		printError(`"${format}" isn't an output format`, 'Use `text` or `json`');
		process.exit(1);
	}
};

export class ArchiveCommand extends Command {
	constructor(name?: string) {
		super(name || 'archive');

		this.description(
			'Move done and cancelled tasks out of tasks.json (restore <id> brings one back)'
		)
			.option(
				'--older-than <days>',
				'Only tasks last changed at least this many days ago (default: global.archiveAfterDays, else 30)'
			)
			.option('--dry-run', 'List what would be archived without moving it')
			.option('-t, --tag <tag>', 'Use a specific tag')
			.option('-f, --format <format>', 'Output format (text, json)', 'text')
			.addOption(jsonOption())
			.option(
				'-p, --project <path>',
				'Project root directory (auto-detected if not provided)'
			)
			.addHelpText(
				'after',
				`
Archived tasks go to .taskgraph/tasks/archive.json. Their IDs are never
reused, and dependencies on them count as done. A finished task with no
recorded update time counts as old enough.

Examples:
  $ taskgraph archive --dry-run
  $ taskgraph archive --older-than 7
  $ taskgraph archive restore 12
`
			)
			.action(async (options: ArchiveCommandOptions) => {
				await this.executeArchive(options);
			});

		this.command('restore')
			.description('Move an archived task back into tasks.json')
			.argument('<id>', 'ID of the archived task')
			.option('-t, --tag <tag>', 'Use a specific tag')
			.option('-f, --format <format>', 'Output format (text, json)', 'text')
			.addOption(jsonOption())
			.option(
				'-p, --project <path>',
				'Project root directory (auto-detected if not provided)'
			)
			.action(async (id: string, options: RestoreCommandOptions) => {
				// `archive` defines --tag, --format and --project too, so Commander
				// hands it those flags even when they come after `restore`
				await this.executeRestore(id, { ...options, ...this.givenOptions() });
			});
	}

	/** The options typed on `archive` itself, without its defaults */
	private givenOptions(): Partial<RestoreCommandOptions> {
		const given: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(this.opts())) {
			if (this.getOptionValueSource(key) !== 'default') given[key] = value;
		}
		return given;
	}

	private async openCore(project?: string): Promise<TmCore> {
		const projectRoot = path.resolve(getProjectRoot(project));
		return createTmCore({ projectPath: projectRoot });
	}

	private async executeArchive(options: ArchiveCommandOptions): Promise<void> {
		checkFormat(options.format);
		let olderThanDays: number | undefined;
		if (options.olderThan !== undefined) {
			olderThanDays = Number(options.olderThan);
			if (!/^\d+$/.test(options.olderThan.trim())) {
				printError(
					`"${options.olderThan}" isn't a number of days`,
					'Try `taskgraph archive --older-than 30`'
				);
				process.exit(1);
			}
		}

		let failed = false;
		try {
			const tmCore = await this.openCore(options.project);
			const result = await tmCore.tasks.archive({
				tag: options.tag,
				olderThanDays,
				dryRun: options.dryRun
			});

			const tasks = result.tasks.map((t) => ({
				id: t.id,
				title: t.title,
				status: t.status
			}));
			if (options.format === 'json') {
				printJson(neutralizeTaskData({ ...result, tasks }));
				return;
			}
			console.log(
				formatArchiveResult(
					{
						tasks,
						olderThanDays: result.olderThanDays,
						dryRun: result.dryRun
					},
					terminalWidth()
				)
			);
		} catch (error: unknown) {
			failed = true;
			displayError(error, { skipExit: true });
		}
		if (failed) process.exit(1);
	}

	private async executeRestore(
		id: string,
		options: RestoreCommandOptions
	): Promise<void> {
		checkFormat(options.format);
		if (!/^\d+(\.\d+)?$/.test(id.trim())) {
			printError(`"${id}" isn't a task ID`, 'Use a number like `12`');
			process.exit(1);
		}

		let failed = false;
		try {
			const tmCore = await this.openCore(options.project);
			const { task, tag } = await tmCore.tasks.restore(id.trim(), {
				tag: options.tag
			});
			if (options.format === 'json') {
				printJson(neutralizeTaskData({ restored: true, tag, task }));
				return;
			}
			console.log(
				formatRestoreResult({ id: task.id, title: task.title }, terminalWidth())
			);
		} catch (error: unknown) {
			failed = true;
			displayError(error, { skipExit: true });
		}
		if (failed) process.exit(1);
	}

	static register(program: Command, name?: string): ArchiveCommand {
		const command = new ArchiveCommand(name);
		program.addCommand(command);
		return command;
	}
}
