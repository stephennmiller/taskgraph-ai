/**
 * @fileoverview `taskgraph scope <ids> up|down`: make tasks more or less
 * complex with the AI, and rewrite their pending subtasks to match.
 * `scope-up` and `scope-down` stay as hidden aliases for scripts (#882).
 * Thin layer over tm-core's tasks.scope(), which checks the strength and
 * every ID before any AI call and saves each task under the tasks.json lock.
 */

import { createTmCore } from '@tm/core';
import chalk from 'chalk';
import { Argument, Command } from 'commander';
import type { Ora } from 'ora';
import { terminalSafe } from '../ui/formatters/markdown-formatters.js';
import { formatScopeResult } from '../ui/formatters/scope-formatters.js';
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

interface ScopeCommandOptions {
	id?: string;
	strength: string;
	prompt?: string;
	research?: boolean;
	file?: string;
	tag?: string;
}

type Direction = 'up' | 'down';

export class ScopeCommand extends Command {
	private spinner?: Ora;
	/** Set by scope-up / scope-down; `scope` takes it as an argument */
	private readonly fixedDirection?: Direction;
	private direction: Direction = 'up';

	/** Print a line; one printed while the spinner runs would be drawn over */
	private print(line: string) {
		this.spinner?.clear();
		console.log(line);
		this.spinner?.render();
	}

	constructor(name: 'scope' | 'scope-up' | 'scope-down' = 'scope') {
		super(name);
		if (name !== 'scope') {
			this.fixedDirection = name === 'scope-down' ? 'down' : 'up';
			this.description(
				`${this.fixedDirection === 'up' ? 'Increase' : 'Decrease'} task complexity with AI assistance`
			);
		} else {
			this.description('Make tasks more (up) or less (down) complex with AI')
				.argument('[ids]', 'Comma-separated task IDs (or use --id)')
				.addArgument(
					new Argument('[direction]', 'up or down').choices(['up', 'down'])
				);
		}

		this.option('-i, --id <ids>', 'Comma-separated task IDs to scope')
			.option(
				'-s, --strength <level>',
				'How far to change it: light, regular, heavy',
				'regular'
			)
			.option(
				'-p, --prompt <text>',
				'Custom instructions for targeted scope adjustments'
			)
			.option('-r, --research', 'Use research AI for more informed adjustments')
			.addOption(legacyFileOption())
			.option('--tag <tag>', 'Specify tag context for task operations')
			.action(async () => {
				let [ids, direction]: (string | undefined)[] = this.args;
				const options = this.opts<ScopeCommandOptions>();
				// With --id, a lone argument is the direction: scope --id=3 up
				if (options.id !== undefined && ids !== undefined) {
					if (direction !== undefined) {
						printError(
							'Give task IDs as an argument or --id, not both',
							`Try \`taskgraph scope ${terminalSafe(options.id)} ${terminalSafe(direction)}\``
						);
						process.exit(1);
					}
					[ids, direction] = [undefined, ids];
					if (direction !== 'up' && direction !== 'down') {
						printError(
							`"${terminalSafe(direction)}" isn't up or down`,
							`Try \`taskgraph scope ${terminalSafe(options.id)} up\` (or down)`
						);
						process.exit(1);
					}
				}
				await this.executeCommand(
					{ ...options, id: options.id ?? ids },
					this.fixedDirection ?? (direction as Direction | undefined)
				);
			});
	}

	private async executeCommand(
		options: ScopeCommandOptions,
		direction: Direction | undefined
	): Promise<void> {
		const name = this.name();
		if (!options.id || !direction) {
			printError(
				options.id ? 'Say up or down' : 'Missing task ID',
				name === 'scope'
					? `Try \`taskgraph scope ${terminalSafe(options.id ?? '3')} up\` (or down)`
					: `Try \`taskgraph ${name} --id=1,2,3 --strength=regular\``
			);
			process.exit(1);
		}
		this.direction = direction;
		const fileError = otherTasksFileError(options.file, name);
		if (fileError) displayError(fileError);
		const projectRoot = getProjectRoot();

		try {
			const tmCore = await createTmCore({ projectPath: projectRoot });
			const tag = options.tag || tmCore.config.getActiveTag();
			displayCommandHeader({ tag, projectRoot });

			const result = await tmCore.tasks.scope(
				{
					ids: options.id as string,
					direction: this.direction,
					strength: options.strength,
					prompt: options.prompt,
					research: options.research,
					tag,
					outputType: 'cli'
				},
				{
					onWarning: (message) =>
						this.print(`${chalk.yellow('⚠')} ${terminalSafe(message)}`),
					onDebug: (message) => this.print(theme.muted(terminalSafe(message))),
					onAiCall: ({ taskId, step }) => {
						this.stopSpinner();
						this.spinner = createSpinner(
							step === 'task'
								? `Making task ${terminalSafe(taskId)} ${this.direction === 'up' ? 'more' : 'less'} complex…`
								: `Rewriting the pending subtasks of task ${terminalSafe(taskId)}…`
						).start();
					}
				}
			);
			this.stopSpinner();
			console.log(`\n${formatScopeResult(result, this.direction)}`);
			const usage = result.telemetryData
				? formatUsageLine(result.telemetryData)
				: '';
			if (usage) console.log(`\n${theme.muted(usage)}`);
		} catch (error: any) {
			this.stopSpinner();
			displayError(error, { hint: error?.hint ?? aiErrorHint(error) });
		}
	}

	private stopSpinner() {
		this.spinner?.stop();
		this.spinner = undefined;
	}
}

export class ScopeUpCommand extends ScopeCommand {
	constructor() {
		super('scope-up');
	}
}

export class ScopeDownCommand extends ScopeCommand {
	constructor() {
		super('scope-down');
	}
}
