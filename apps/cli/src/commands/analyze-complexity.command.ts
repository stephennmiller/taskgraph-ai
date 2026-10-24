/**
 * @fileoverview `taskgraph analyze-complexity`: score the tag's active tasks
 * with the AI and save the tag's complexity report. Thin layer over
 * tm-core's tasks.analyzeComplexity().
 */

import path from 'node:path';
import { createTmCore } from '@tm/core';
import chalk from 'chalk';
import { Command, Option } from 'commander';
import type { Ora } from 'ora';
import { formatComplexityRun } from '../ui/formatters/complexity-report-formatters.js';
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
import {
	legacyFileOption,
	otherTasksFileError
} from '../utils/tasks-file-option.js';

export interface AnalyzeComplexityCommandOptions {
	output?: string;
	threshold?: string;
	file?: string;
	research?: boolean;
	id?: string;
	from?: string;
	to?: string;
	tag?: string;
}

/** The report path relative to the project, as the user would type it */
function displayPath(filePath: string, projectRoot: string): string {
	const relative = path.relative(projectRoot, filePath);
	return relative && !relative.startsWith('..') ? relative : filePath;
}

export class AnalyzeComplexityCommand extends Command {
	constructor(name?: string) {
		super(name || 'analyze-complexity');

		this.description('Analyze tasks and generate expansion recommendations')
			.option('-o, --output <file>', 'Output file path for the report')
			// Never used; kept so scripts that pass it keep working
			.addOption(new Option('-m, --model <model>').hideHelp())
			.option(
				'-t, --threshold <number>',
				'Minimum complexity score to recommend expansion (1-10)',
				'5'
			)
			.addOption(legacyFileOption())
			.option(
				'-r, --research',
				'Use configured research model for research-backed complexity analysis'
			)
			.option(
				'-i, --id <ids>',
				'Comma-separated list of specific task IDs to analyze (e.g., "1,3,5")'
			)
			.option('--from <id>', 'Starting task ID in a range to analyze')
			.option('--to <id>', 'Ending task ID in a range to analyze')
			.option('--tag <tag>', 'Specify tag context for task operations')
			.action(async (options: AnalyzeComplexityCommandOptions) => {
				await this.executeCommand(options);
			});
	}

	private async executeCommand(
		options: AnalyzeComplexityCommandOptions
	): Promise<void> {
		const fileError = otherTasksFileError(options.file, 'analyze-complexity');
		if (fileError) displayError(fileError);
		const projectRoot = getProjectRoot();

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

			const result = await tmCore.tasks.analyzeComplexity(
				{
					ids: options.id,
					from: options.from,
					to: options.to,
					threshold: options.threshold,
					research: options.research,
					output: options.output,
					tag,
					outputType: 'cli'
				},
				{
					onWarning: (message) =>
						print(`${chalk.yellow('⚠')} ${terminalSafe(message)}`),
					onDebug: (message) => print(theme.muted(terminalSafe(message))),
					onAiCall: ({ taskCount }) => {
						spinner = createSpinner(
							`Analyzing ${taskCount} ${taskCount === 1 ? 'task' : 'tasks'}${options.research ? ' with web research' : ''}…`
						).start();
					}
				}
			);
			spinner?.stop();

			if (result.unchanged) {
				console.log(chalk.dim('The complexity report is unchanged'));
				return;
			}
			console.log(
				formatComplexityRun({
					analyses: result.analyses,
					skipped: result.skipped,
					kept: result.kept,
					reportPath: displayPath(result.reportPath, projectRoot),
					usedResearch: options.research === true
				})
			);
			const usage = result.telemetryData
				? formatUsageLine(result.telemetryData)
				: '';
			if (usage) console.log(`\n${theme.muted(usage)}`);
		} catch (error: any) {
			if (spinner?.isSpinning) spinner.fail();
			printError(
				`Couldn't analyze task complexity: ${terminalSafe(error?.message ?? String(error))}`,
				error?.hint ?? aiErrorHint(error)
			);
			process.exit(1);
		}
	}

	static register(program: Command, name?: string): AnalyzeComplexityCommand {
		const command = new AnalyzeComplexityCommand(name);
		program.addCommand(command);
		return command;
	}
}
