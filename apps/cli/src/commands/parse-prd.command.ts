/**
 * @fileoverview `taskgraph parse-prd`: generate the tag's tasks from a PRD
 * with the AI, streaming each task as the model finishes it. `--clarify`
 * asks about gaps in the PRD first and saves the answers in it; `--answers`
 * saves answers given in a file. Thin layer over tm-core's tasks.parsePrd(),
 * which saves under the tasks.json lock without dropping changes made while
 * the AI was writing.
 */

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import {
	type Clarification,
	type ParsePrdHooks,
	type TmCore,
	createTmCore,
	neutralizeTaskData,
	parseClarificationAnswers,
	writeClarifications
} from '@tm/core';
import chalk from 'chalk';
import { Command, Option } from 'commander';
import type { Ora } from 'ora';
import { ParsePrdProgress } from '../ui/components/parse-prd-progress.component.js';
import {
	formatClarificationsSaved,
	formatClarifyCancelled,
	formatNoClarifyQuestions
} from '../ui/formatters/clarify-formatters.js';
import { terminalSafe } from '../ui/formatters/markdown-formatters.js';
import { formatParsePrdSaved } from '../ui/formatters/parse-prd-formatters.js';
import { formatPrdDelta } from '../ui/formatters/prd-delta-formatters.js';
import { formatUsageLine } from '../ui/formatters/usage-formatters.js';
import { createSpinner } from '../ui/spinner.js';
import { theme } from '../ui/theme.js';
import { displayCommandHeader } from '../utils/display-helpers.js';
import {
	aiErrorHint,
	describeError,
	displayError,
	printError
} from '../utils/error-handler.js';
import { printJson } from '../utils/json-output.js';
import { getProjectRoot } from '../utils/project-root.js';
import { otherTasksFileError } from '../utils/tasks-file-option.js';
import { collectClarifications } from './parse-prd/clarify-prompts.js';

export interface ParsePrdCommandOptions {
	input?: string;
	output?: string;
	numTasks?: string;
	force?: boolean;
	append?: boolean;
	research?: boolean;
	clarify?: boolean;
	answers?: string;
	json?: boolean;
	yes?: boolean;
	tag?: string;
}

/** --clarify's flags that need each other, or exclude each other */
function clarifyFlagError(
	options: ParsePrdCommandOptions
): { message: string; hint: string } | null {
	if (options.clarify && options.answers) {
		return {
			message: '--clarify and --answers both supply the answers',
			hint: 'Use --clarify to be asked, or --answers <file> to pass them in'
		};
	}
	if (options.json && !options.clarify) {
		return {
			message: '--json only works with --clarify',
			hint: 'Try `taskgraph parse-prd prd.md --clarify --json`'
		};
	}
	if (options.yes && !options.clarify) {
		return {
			message: '--yes only works with --clarify',
			hint: 'Try `taskgraph parse-prd prd.md --clarify --yes`'
		};
	}
	return null;
}

/** A path as the user typed it: relative to the current folder */
function displayPath(file: string): string {
	const relative = path.relative(process.cwd(), file);
	return relative && !relative.startsWith('..') ? relative : file;
}

/** --answers: a JSON file, or - for stdin */
function readClarificationAnswers(source: string): Clarification[] {
	const text = fs.readFileSync(source === '-' ? 0 : source, 'utf8');
	let json: unknown;
	try {
		json = JSON.parse(text);
	} catch {
		throw new Error("it isn't valid JSON");
	}
	return parseClarificationAnswers(json);
}

/**
 * Ask before replacing the tag's tasks. Without a terminal nobody can
 * answer, and readline would wait forever, so it fails instead (#481)
 */
async function confirmOverwrite(): Promise<boolean> {
	if (!process.stdin.isTTY) {
		printError(
			"This tag has tasks and there's no terminal to ask before replacing them",
			'Run again with --append to add to them or --force to replace them'
		);
		process.exit(1);
	}
	console.log(
		`${chalk.yellow('⚠')} This tag has tasks; parse-prd replaces them` +
			theme.muted(' (--append adds to them)')
	);
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout
	});
	const answer = await new Promise<string>((resolve) =>
		rl.question(theme.brand('Replace them? (y/N) '), resolve)
	);
	rl.close();
	return ['y', 'yes'].includes(answer.toLowerCase());
}

export class ParsePrdCommand extends Command {
	private spinner?: Ora;
	private progress?: ParsePrdProgress;

	constructor(name?: string) {
		super(name || 'parse-prd');

		this.description('Parse a PRD file and generate tasks')
			.argument('[file]', 'Path to the PRD file')
			.option(
				'-i, --input <file>',
				'Path to the PRD file (alternative to positional argument)'
			)
			// Tasks live in the project's tasks.json; only that file is accepted
			.addOption(new Option('-o, --output <file>').hideHelp())
			.option(
				'-n, --num-tasks <number>',
				'About how many tasks (default: sized to the PRD)'
			)
			.option(
				'-f, --force',
				'Skip confirmation when overwriting existing tasks'
			)
			.option(
				'--append',
				'Append new tasks to existing tasks.json instead of overwriting'
			)
			.option(
				'-r, --research',
				'Use Claude Code web research for research-backed task generation, providing more comprehensive and accurate task breakdown'
			)
			.option(
				'--clarify',
				'Ask up to 5 questions about gaps in the PRD first and save the answers in it'
			)
			.option(
				'--answers <file>',
				'Save answers (JSON from --clarify --json, or - for stdin) in the PRD, then generate tasks'
			)
			.option('--json', 'With --clarify: print the questions as JSON and stop')
			.option('-y, --yes', 'With --clarify: accept the suggested answers')
			.option('--tag <tag>', 'Specify tag context for task operations')
			.action(
				async (file: string | undefined, options: ParsePrdCommandOptions) => {
					await this.executeCommand(file, options);
				}
			);
	}

	private async executeCommand(
		file: string | undefined,
		options: ParsePrdCommandOptions
	): Promise<void> {
		const prdArg = options.input || file;
		// A mistyped path is the common failure; say so before anything else
		if (prdArg && !fs.existsSync(path.resolve(prdArg))) {
			printError(
				`${terminalSafe(prdArg)} not found`,
				'Check the spelling; paths are relative to this folder'
			);
			process.exit(1);
		}
		// Flags that only work together; checked before any AI call or write
		const flagError = clarifyFlagError(options);
		if (flagError) {
			printError(flagError.message, flagError.hint);
			process.exit(1);
		}
		let answersFromFile: Clarification[] | null = null;
		if (options.answers) {
			if (
				options.answers !== '-' &&
				!fs.existsSync(path.resolve(options.answers))
			) {
				printError(
					`${terminalSafe(options.answers)} not found`,
					'Check the spelling; paths are relative to this folder'
				);
				process.exit(1);
			}
			try {
				answersFromFile = readClarificationAnswers(options.answers);
			} catch (error) {
				printError(
					`Couldn't read the answers in ${terminalSafe(options.answers)}: ${(error as Error).message}`,
					'Add an "answer" to each question in the output of --clarify --json'
				);
				process.exit(1);
			}
		}
		const fileError = otherTasksFileError(
			options.output,
			'parse-prd',
			undefined,
			'--output'
		);
		if (fileError) displayError(fileError);

		const projectRoot = getProjectRoot();
		let tmCore: TmCore;
		let target: Awaited<ReturnType<TmCore['tasks']['parsePrdTarget']>>;
		try {
			tmCore = await createTmCore({ projectPath: projectRoot });
			target = await tmCore.tasks.parsePrdTarget({
				prdPath: prdArg && path.resolve(prdArg),
				tag: options.tag
			});
		} catch (error: any) {
			displayError(error, {
				hint:
					error?.hint ??
					(prdArg ? undefined : 'Try `taskgraph parse-prd prd.md`')
			});
			return;
		}
		const { prdPath, tag } = target;
		const research = options.research === true;

		// --clarify --json: print the questions for an agent to ask, and stop.
		// stdout carries only the JSON
		if (options.clarify && options.json) {
			try {
				// stderr, so stdout stays JSON
				const { questions } = await tmCore.tasks.findPrdGaps(
					{ prdPath, research },
					this.logHooks(console.error)
				);
				// The AI read the PRD: no question can close a fence an agent reads
				printJson(neutralizeTaskData({ prd: displayPath(prdPath), questions }));
			} catch (error) {
				printError(
					`Couldn't find questions to ask: ${(error as Error).message}`
				);
				process.exit(1);
			}
			return;
		}

		displayCommandHeader({ tag, projectRoot });

		try {
			let force = options.force === true;
			if (target.taskCount > 0 && !force && !options.append) {
				if (!(await confirmOverwrite())) {
					console.log(theme.muted('Cancelled; no tasks changed'));
					return;
				}
				force = true;
			}

			// Answers go into the PRD first, so the tasks are generated from them
			const answers =
				answersFromFile ??
				(options.clarify
					? await this.clarify(tmCore, prdPath, research, options.yes)
					: []);
			if (answers.length > 0) {
				const saved = writeClarifications(prdPath, answers);
				console.log(
					formatClarificationsSaved(saved, terminalSafe(displayPath(prdPath)))
				);
			}

			// The progress display names the file, task count and research,
			// and the saved line the new total, so no preamble
			const result = await tmCore.tasks.parsePrd(
				{
					prdPath,
					numTasks: options.numTasks,
					force,
					append: options.append === true,
					research,
					tag,
					stream: true,
					outputType: 'cli'
				},
				this.hooks(prdPath, research)
			);
			if (result.prdDelta?.known && result.added === 0) return;
			console.log(
				formatParsePrdSaved({
					tasksPath: terminalSafe(
						path.relative(process.cwd(), result.tasksPath) || result.tasksPath
					),
					added: result.added,
					total: result.total,
					research
				})
			);
			const usage = formatUsageLine(result.telemetryData);
			if (usage) console.log(`\n${theme.muted(usage)}`);
		} catch (error: any) {
			this.stopProgress();
			const { message, hint } = describeError(
				error,
				error?.hint ?? aiErrorHint(error)
			);
			printError(`Couldn't generate tasks: ${message}`, hint);
			process.exit(1);
		}
	}

	/** Warnings, and with global.debug on AI detail and the full error, above the spinner */
	private logHooks(
		write: (line: string) => void = console.log
	): Pick<ParsePrdHooks, 'onWarning' | 'onDebug'> {
		const print = (line: string) => {
			this.spinner?.clear();
			write(line);
			this.spinner?.render();
		};
		return {
			onWarning: (message) =>
				print(`${chalk.yellow('⚠')} ${terminalSafe(message)}`),
			onDebug: (message) => print(theme.muted(terminalSafe(message)))
		};
	}

	/** Progress for the AI call: the streamed list, else a spinner */
	private hooks(prdPath: string, research: boolean): ParsePrdHooks {
		return {
			...this.logHooks(),
			onPrdDelta: (delta) => console.log(formatPrdDelta(delta)),
			onAiCall: ({ numTasks, startId, streaming }) => {
				if (streaming) {
					this.progress = new ParsePrdProgress({
						prdName: terminalSafe(path.basename(prdPath)),
						numTasks,
						startId,
						research
					}).start();
				} else {
					this.spinner = createSpinner(
						'Parsing PRD and generating tasks…'
					).start();
				}
			},
			onPartial: (partial) => this.progress?.update(partial),
			onGenerated: (tasks, streamed) => {
				if (streamed) {
					this.progress?.succeed({ tasks });
				} else {
					this.spinner?.succeed(`${tasks.length} tasks generated`);
				}
				this.progress = undefined;
				this.spinner = undefined;
			},
			onStreamFailed: (_error, retrying) => {
				// No ✗ here: the command prints the failure once, with its reason (#388)
				const printed = this.progress?.printedCount ?? 0;
				this.stopProgress();
				if (retrying && printed > 0) {
					console.log(
						`${chalk.yellow('⚠')} Live output stopped. Asking Claude again in one request; the final tasks may differ from the ones above.`
					);
				}
			}
		};
	}

	/**
	 * --clarify in the terminal: find gaps in the PRD, then ask about them
	 * (or take the suggested answers without a terminal or with --yes)
	 */
	private async clarify(
		tmCore: TmCore,
		prdPath: string,
		research: boolean,
		yes?: boolean
	): Promise<Clarification[]> {
		const prdName = terminalSafe(displayPath(prdPath));
		this.spinner = createSpinner(`Reading ${prdName} for gaps…`).start();
		let questions;
		try {
			({ questions } = await tmCore.tasks.findPrdGaps(
				{ prdPath, research },
				this.logHooks()
			));
		} finally {
			this.stopProgress();
		}
		if (questions.length === 0) {
			console.log(formatNoClarifyQuestions(prdName));
			return [];
		}
		const answers = await collectClarifications(questions, { prdName, yes });
		if (answers === null) {
			console.log(formatClarifyCancelled(prdName));
			process.exit(130);
		}
		return answers;
	}

	private stopProgress() {
		this.progress?.stop();
		this.progress = undefined;
		this.spinner?.stop();
		this.spinner = undefined;
	}

	static register(program: Command, name?: string): ParsePrdCommand {
		const command = new ParsePrdCommand(name);
		program.addCommand(command);
		return command;
	}
}
