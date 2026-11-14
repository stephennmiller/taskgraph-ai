/**
 * @fileoverview `taskgraph lang`: show or set the language AI responses are
 * written in, through tm-core's config domain
 */

import { createTmCore, isConfigFilePresent } from '@tm/core';
import chalk from 'chalk';
import { Command } from 'commander';
import { projectOption } from '../utils/shared-options.js';
import { terminalSafe } from '../ui/formatters/markdown-formatters.js';
import { theme } from '../ui/theme.js';
import { printError } from '../utils/error-handler.js';
import { getProjectRoot } from '../utils/project-root.js';

interface LangCommandOptions {
	response?: string;
	setup?: boolean;
	project?: string;
}

export class LangCommand extends Command {
	constructor(name?: string) {
		super(name || 'lang');

		this.description('View or change the AI response language')
			.option('--response <response_language>', 'Set the response language')
			.option('--setup', 'Choose the response language interactively')
			.addOption(projectOption())
			.addHelpText(
				'after',
				`
Examples:
  $ taskgraph lang                       # Show the response language
  $ taskgraph lang --response French     # Set it
  $ taskgraph lang --setup               # Choose it interactively`
			)
			.action(async (options: LangCommandOptions) => {
				await this.executeCommand(options);
			});
	}

	private async executeCommand(options: LangCommandOptions): Promise<void> {
		const projectRoot = getProjectRoot(options.project);
		if (!isConfigFilePresent(projectRoot)) {
			printError(
				'No .taskgraph/config.json in this project',
				'Run `taskgraph init` to recreate it'
			);
			process.exit(1);
		}
		const { config } = await createTmCore({ projectPath: projectRoot });
		const current = config.getResponseLanguage();
		let language = options.response;

		if (options.setup) {
			// Without a terminal the prompt writes escapes into the pipe and waits
			if (!(process.stdin.isTTY && process.stdout.isTTY)) {
				printError(
					'lang --setup needs a terminal to ask its question',
					'Set it directly: `taskgraph lang --response <language>`'
				);
				process.exitCode = 1;
				return;
			}
			try {
				const { default: inquirer } = await import('inquirer');
				const answer = await inquirer.prompt([
					{
						type: 'input',
						name: 'language',
						message: 'Language for AI responses?',
						default: current
					}
				]);
				language = answer.language;
			} catch (error) {
				if ((error as Error)?.name !== 'ExitPromptError') throw error;
				console.log(theme.muted('\nCancelled; response language unchanged'));
				process.exitCode = 130;
				return;
			}
		}

		// Without --response or --setup, show the setting instead of
		// resetting it to English
		if (language === undefined) {
			console.log(`Response language: ${theme.brand(terminalSafe(current))}`);
			console.log(
				theme.muted('Change it with ') +
					theme.brand('taskgraph lang --response <language>')
			);
			return;
		}

		language = language.trim();
		const result = config.setResponseLanguage(language);
		if (!result.success) {
			printError(
				`Couldn't set the response language: ${terminalSafe(result.error.message)}`
			);
			process.exit(1);
		}
		const shown = terminalSafe(language);
		const change =
			language === current
				? `${theme.brand(shown)} ${theme.muted('(unchanged)')}`
				: `${terminalSafe(current)} → ${theme.brand(shown)}`;
		console.log(`${chalk.green('✓')} Response language  ${change}`);
	}

	static register(program: Command, name?: string): LangCommand {
		const command = new LangCommand(name);
		program.addCommand(command);
		return command;
	}
}
