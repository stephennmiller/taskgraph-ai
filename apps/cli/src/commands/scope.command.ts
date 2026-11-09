/**
 * @fileoverview `taskgraph scope <ids> up|down`: make tasks more or less
 * complex with the AI, and rewrite their pending subtasks to match.
 * `scope-up` and `scope-down` stay as hidden aliases for scripts (#882).
 * Thin layer over tm-core's tasks.scope(), which checks the strength and
 * every ID before any AI call and saves each task under the tasks.json lock.
 */

import { createTmCore, exitOnStopSignals } from '@tm/core';
import chalk from 'chalk';
import { Argument, Command } from 'commander';
import type { Ora } from 'ora';
import { terminalSafe } from '../ui/formatters/markdown-formatters.js';
import { formatScopeResult } from '../ui/formatters/scope-formatters.js';
import { formatUsageLine } from '../ui/formatters/usage-formatters.js';
import { createSpinner } from '../ui/spinner.js';
import { theme } from '../ui/theme.js';
import { displayCommandHeader } from '../utils/display-helpers.js';
import { noticeOldAlias } from '../utils/alias-notice.js';
import {
	aiErrorHint,
	displayError,
	printError
} from '../utils/error-handler.js';
import { rejectDifferentId } from '../utils/id-argument.js';
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

const ID_HELP = 'Task IDs, e.g. 3 or 1,2 (same as --id)';

/** `3`, `3.2`, or a comma-separated list of those */
function isIdList(value: string): boolean {
	return /^(\s*\d+(\.\d+)?\s*)(,\s*\d+(\.\d+)?\s*)*$/.test(value);
}

/**
 * `scope 3 up` and `scope --id=3 up` mean the same. With --id, a lone
 * argument is the direction. Two different IDs exit 1.
 */
function resolveScopeTargets(
	command: string,
	argIds: string | undefined,
	argDirection: string | undefined,
	flag: string | undefined,
	positionalDirection: boolean
): { ids: string | undefined; direction: string | undefined } {
	let ids = argIds;
	let direction = argDirection;
	if (flag !== undefined && ids !== undefined) {
		if (
			positionalDirection &&
			direction === undefined &&
			(ids === 'up' || ids === 'down')
		) {
			direction = ids;
			ids = undefined;
		} else if (
			positionalDirection &&
			direction === undefined &&
			!isIdList(ids)
		) {
			printError(
				`"${terminalSafe(ids)}" isn't up or down`,
				`Try \`taskgraph ${command} ${terminalSafe(flag)} up\` (or down)`
			);
			process.exit(1);
		} else if (ids !== flag) {
			const example =
				direction !== undefined
					? `${terminalSafe(flag)} ${terminalSafe(direction)}`
					: positionalDirection
						? `${terminalSafe(flag)} up`
						: terminalSafe(flag);
			rejectDifferentId(ids, flag, `taskgraph ${command} ${example}`);
		} else {
			ids = undefined;
		}
	}
	return { ids: flag ?? ids, direction };
}

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
			).argument('[ids]', ID_HELP);
		} else {
			this.description('Make tasks more (up) or less (down) complex with AI')
				.argument('[ids]', ID_HELP)
				.addArgument(
					new Argument('[direction]', 'up or down').choices(['up', 'down'])
				)
				.addHelpText(
					'after',
					`
Examples:
  $ taskgraph scope 3 up
  $ taskgraph scope --id=3 up
  $ taskgraph scope 1,2 down
`
				);
		}

		this.option('-i, --id <ids>', 'The same as the [ids] argument')
			.option(
				'-s, --strength <level>',
				'How far to change it: light, regular, heavy',
				'regular'
			)
			.option(
				'--prompt <text>',
				'Custom instructions for targeted scope adjustments'
			)
			.option('-r, --research', 'Use research AI for more informed adjustments')
			.addOption(legacyFileOption())
			.option('--tag <tag>', 'Specify tag context for task operations')
			.action(async () => {
				const [argIds, argDirection] = this.args as (string | undefined)[];
				const options = this.opts<ScopeCommandOptions>();
				const { ids, direction } = resolveScopeTargets(
					this.name(),
					argIds,
					argDirection,
					options.id,
					this.fixedDirection === undefined
				);
				await exitOnStopSignals(() =>
					this.executeCommand(
						{ ...options, id: ids },
						this.fixedDirection ?? (direction as Direction | undefined)
					)
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
					: `Try \`taskgraph scope 1,2,3 ${this.fixedDirection}\``
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
		noticeOldAlias(this, 'scope <ids> up');
	}
}

export class ScopeDownCommand extends ScopeCommand {
	constructor() {
		super('scope-down');
		noticeOldAlias(this, 'scope <ids> down');
	}
}
