/**
 * @fileoverview `taskgraph research`: ask the research model a question with
 * project context, print the answer, and at a terminal offer follow-ups and
 * saving. Thin layer over tm-core's tasks.research() and saveResearch().
 */

import path from 'node:path';
import {
	type ResearchExchange,
	type ResearchInput,
	type ResearchResult,
	createTmCore,
	isTaskOrSubtaskId
} from '@tm/core';
import chalk from 'chalk';
import { Command, Option } from 'commander';
import type { Ora } from 'ora';
import { terminalSafe } from '../ui/formatters/markdown-formatters.js';
import {
	type ResearchSaveTarget,
	formatResearchAnswer,
	formatResearchContext,
	formatResearchSaveFailed,
	formatResearchSaved
} from '../ui/formatters/research-formatters.js';
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
import { otherTasksFileError } from '../utils/tasks-file-option.js';

export interface ResearchCommandOptions {
	file?: string;
	id?: string;
	files?: string;
	context?: string;
	tree?: boolean;
	save?: string;
	detail?: string;
	saveTo?: string;
	saveFile?: boolean;
	tag?: string;
}

type TmCore = Awaited<ReturnType<typeof createTmCore>>;

const list = (value?: string) =>
	value
		?.split(',')
		.map((item) => item.trim())
		.filter(Boolean) ?? [];

export class ResearchCommand extends Command {
	constructor(name?: string) {
		super(name || 'research');

		this.description('Perform AI-powered research queries with project context')
			.argument('[prompt]', 'Research prompt to investigate')
			// -f is --files here, so the legacy flag has no short form
			.addOption(new Option('--file <file>').hideHelp())
			.option(
				'-i, --id <ids>',
				'Comma-separated task/subtask IDs to include as context (e.g., "15,16.2")'
			)
			.option(
				'-f, --files <paths>',
				'Comma-separated file paths to include as context'
			)
			.option(
				'-c, --context <text>',
				'Additional custom context to include in the research prompt'
			)
			.option(
				'-t, --tree',
				'Include project file tree structure in the research context'
			)
			.option('-s, --save <file>', 'Save the answer to a markdown file')
			.option(
				'-d, --detail <level>',
				'Output detail level: low, medium, high',
				'medium'
			)
			.option(
				'--save-to <id>',
				'Add the answer to a task or subtask\'s details (e.g., "15" or "15.2")'
			)
			.option('--save-file', 'Save the answer to .taskgraph/docs/research/')
			.option('--tag <tag>', 'Specify tag context for task operations')
			.action(
				async (prompt: string | undefined, options: ResearchCommandOptions) => {
					await this.executeCommand(prompt, options);
				}
			);
	}

	private async executeCommand(
		prompt: string | undefined,
		options: ResearchCommandOptions
	): Promise<void> {
		if (!prompt?.trim()) {
			printError(
				'Research needs a question',
				'Example: taskgraph research "How should we store sessions?" --id=3'
			);
			process.exit(1);
		}
		const fileError = otherTasksFileError(options.file, 'research');
		if (fileError) displayError(fileError);
		const projectRoot = getProjectRoot();

		try {
			const tmCore = await createTmCore({ projectPath: projectRoot });
			const tag = options.tag || tmCore.config.getActiveTag();
			if (displayCommandHeader({ tag, projectRoot })) console.log();

			const input: ResearchInput = {
				query: prompt,
				taskIds: list(options.id),
				filePaths: list(options.files),
				customContext: options.context,
				includeProjectTree: Boolean(options.tree),
				detailLevel: options.detail,
				tag,
				outputType: 'cli'
			};
			const result = await this.ask(tmCore, {
				...input,
				saveTo: options.saveTo,
				saveToFile: Boolean(options.saveFile),
				// --save is relative to where you run the command
				saveAs:
					options.save === undefined
						? undefined
						: path.resolve(process.cwd(), options.save)
			});

			if (result.savedTo) {
				console.log(
					formatResearchSaved({ kind: 'task', id: result.savedTo.id })
				);
			}
			for (const saved of [result.savedFilePath, result.savedAs]) {
				if (saved) {
					console.log(
						formatResearchSaved({
							kind: 'file',
							path: path.relative(projectRoot, saved)
						})
					);
				}
			}
			for (const failure of result.saveFailures) {
				console.log(formatResearchSaveFailed(failure, failure.message));
				process.exitCode = 1;
			}

			if (process.stdin.isTTY && process.stdout.isTTY) {
				await this.followUp(tmCore, input, [result.exchange]);
			}
		} catch (error: any) {
			displayError(error, { hint: error?.hint ?? aiErrorHint(error) });
		}
	}

	/** One question: the context line, a spinner, the answer and usage line */
	private async ask(
		tmCore: TmCore,
		input: ResearchInput
	): Promise<ResearchResult> {
		let spinner: Ora | undefined;
		let ticker: NodeJS.Timeout | undefined;
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
			const result = await tmCore.tasks.research(input, {
				onWarning: (message) =>
					print(`${chalk.yellow('⚠')} ${terminalSafe(message)}`),
				onDebug: (message) => print(theme.muted(terminalSafe(message))),
				onAiCall: (context) => {
					const line = formatResearchContext({
						taskIds: context.taskIds,
						relatedTaskIds: context.relatedTaskIds,
						files: context.files,
						projectTree: context.projectTree,
						customContext: context.customContext
					});
					if (line) console.log(line);
					const started = Date.now();
					spinner = createSpinner('Researching…').start();
					ticker = setInterval(() => {
						if (spinner) {
							spinner.text = `Researching… ${Math.round((Date.now() - started) / 1000)}s`;
						}
					}, 1000);
				}
			});
			clearInterval(ticker);
			spinner?.stop();
			console.log(`\n${formatResearchAnswer(result.result)}`);
			const usage = result.telemetryData
				? formatUsageLine(result.telemetryData)
				: '';
			if (usage) console.log(`\n${theme.muted(usage)}`);
			return result;
		} catch (error: any) {
			clearInterval(ticker);
			if (spinner?.isSpinning) spinner.fail();
			throw error;
		}
	}

	/** Follow-up questions and saves, until you choose Done or press Ctrl-C */
	private async followUp(
		tmCore: TmCore,
		input: ResearchInput,
		history: ResearchExchange[]
	): Promise<void> {
		const { default: inquirer } = await import('inquirer');
		const save = async (target: ResearchSaveTarget, taskId?: string) => {
			try {
				const saved = await tmCore.tasks.saveResearch(
					history,
					taskId ? { taskId } : { file: true },
					input.tag
				);
				console.log(formatResearchSaved(saved));
			} catch (error: any) {
				console.log(formatResearchSaveFailed(target, error.message));
			}
		};
		try {
			for (;;) {
				console.log();
				const { action } = await inquirer.prompt([
					{
						type: 'select',
						name: 'action',
						message: 'What next?',
						choices: [
							{ name: 'Ask a follow-up', value: 'followup' },
							{ name: 'Save to a file', value: 'savefile' },
							{ name: 'Save to a task', value: 'save' },
							{ name: 'Done', value: 'quit' }
						]
					}
				]);
				if (action === 'quit') return;
				if (action === 'savefile') {
					await save({ kind: 'file', path: '' });
				} else if (action === 'save') {
					const { taskId } = await inquirer.prompt([
						{
							type: 'input',
							name: 'taskId',
							message: 'Task ID (15, or 15.2 for a subtask):',
							validate: (value: string) =>
								isTaskOrSubtaskId((value || '').trim()) ||
								'Use 15 for a task or 15.2 for a subtask'
						}
					]);
					await save({ kind: 'task', id: taskId.trim() }, taskId.trim());
				} else {
					const { question } = await inquirer.prompt([
						{
							type: 'input',
							name: 'question',
							message: 'Follow-up question:',
							validate: (value: string) =>
								value?.trim().length > 0 ||
								'Type a question, or press Ctrl-C to stop'
						}
					]);
					console.log();
					// Tasks are searched again for the new question
					const result = await this.ask(tmCore, {
						...input,
						query: question,
						taskIds: [],
						history
					});
					history.push(result.exchange);
				}
			}
		} catch (error: any) {
			// Ctrl-C at a prompt ends the session quietly
			if (error?.name !== 'ExitPromptError') {
				console.log(chalk.red(`✗ ${terminalSafe(error.message)}`));
			}
		}
	}

	static register(program: Command, name?: string): ResearchCommand {
		const command = new ResearchCommand(name);
		program.addCommand(command);
		return command;
	}
}
