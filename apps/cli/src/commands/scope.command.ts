/**
 * @fileoverview `taskgraph scope-up` and `scope-down`: make tasks more or
 * less complex with the AI, and rewrite their pending subtasks to match.
 * Thin layer over tm-core's tasks.scope(), which checks the strength and
 * every ID before any AI call and saves each task under the tasks.json lock.
 */

import { createTmCore } from '@tm/core';
import chalk from 'chalk';
import { Command } from 'commander';
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

class ScopeCommand extends Command {
	private spinner?: Ora;
	private readonly direction: 'up' | 'down';

	/** Print a line; one printed while the spinner runs would be drawn over */
	private print(line: string) {
		this.spinner?.clear();
		console.log(line);
		this.spinner?.render();
	}

	constructor(name: 'scope-up' | 'scope-down') {
		super(name);
		this.direction = name === 'scope-down' ? 'down' : 'up';
		const more = this.direction === 'up' ? 'Increase' : 'Decrease';

		this.description(`${more} task complexity with AI assistance`)
			.option(
				'-i, --id <ids>',
				`Comma-separated task IDs to scope ${this.direction} (required)`
			)
			.option(
				'-s, --strength <level>',
				`Complexity ${this.direction === 'up' ? 'increase' : 'decrease'} strength: light, regular, heavy`,
				'regular'
			)
			.option(
				'--prompt <text>',
				'Custom instructions for targeted scope adjustments'
			)
			.option('-r, --research', 'Use research AI for more informed adjustments')
			.addOption(legacyFileOption())
			.option('--tag <tag>', 'Specify tag context for task operations')
			.action(async (options: ScopeCommandOptions) => {
				await this.executeCommand(options);
			});
	}

	private async executeCommand(options: ScopeCommandOptions): Promise<void> {
		const name = `scope-${this.direction}`;
		if (!options.id) {
			printError(
				'Missing task ID',
				`Try \`taskgraph ${name} --id=1,2,3 --strength=regular\``
			);
			process.exit(1);
		}
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
