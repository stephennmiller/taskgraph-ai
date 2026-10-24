/**
 * @fileoverview `taskgraph complexity-report`: show the tag's complexity
 * report, each task with its score, recommended subtasks and reasoning.
 * Without a report it says how to make one and exits 1, never asking.
 */

import {
	COMPLEXITY_REPORT_FILE,
	type ComplexityReportFile,
	createTmCore
} from '@tm/core';
import { Command } from 'commander';
import { formatComplexityReport } from '../ui/formatters/complexity-report-formatters.js';
import { displayCommandHeader } from '../utils/display-helpers.js';
import { displayError, printError } from '../utils/error-handler.js';
import { getProjectRoot } from '../utils/project-root.js';

export interface ComplexityReportCommandOptions {
	file?: string;
	tag?: string;
}

export class ComplexityReportCommand extends Command {
	constructor(name?: string) {
		super(name || 'complexity-report');

		this.description('Display the complexity analysis report')
			.option(
				'-f, --file <file>',
				'Path to the report file',
				COMPLEXITY_REPORT_FILE
			)
			.option('--tag <tag>', 'Specify tag context for task operations')
			.action(async (options: ComplexityReportCommandOptions) => {
				await this.executeCommand(options);
			});
	}

	private async executeCommand(
		options: ComplexityReportCommandOptions
	): Promise<void> {
		const projectRoot = getProjectRoot();
		let found: { report: ComplexityReportFile } | null;
		try {
			const tmCore = await createTmCore({ projectPath: projectRoot });
			const tag = options.tag || tmCore.config.getActiveTag();
			if (displayCommandHeader({ tag, projectRoot })) console.log();
			found = tmCore.tasks.getComplexityReport({
				tag,
				// The default names the master report; each tag has its own
				file: options.file === COMPLEXITY_REPORT_FILE ? undefined : options.file
			});
		} catch (error: any) {
			displayError(error, {
				hint: 'Run `taskgraph analyze-complexity` to create it again'
			});
			return;
		}
		if (!found) {
			printError(
				'No complexity report for this tag yet',
				'Run `taskgraph analyze-complexity` to create one'
			);
			process.exit(1);
		}
		console.log(formatComplexityReport(found.report));
	}

	static register(program: Command, name?: string): ComplexityReportCommand {
		const command = new ComplexityReportCommand(name);
		program.addCommand(command);
		return command;
	}
}
