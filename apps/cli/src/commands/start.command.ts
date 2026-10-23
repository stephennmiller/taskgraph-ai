/**
 * @fileoverview `taskgraph start [id]`: a hidden, deprecated alias of
 * `taskgraph loop -n 1 --id <id>`, kept for one release so scripts keep
 * working. It prints one notice to stderr, then runs the loop.
 */

import { Command, Option } from 'commander';
import { formatStartDeprecation } from '../ui/formatters/loop-formatters.js';
import { printError } from '../utils/error-handler.js';
import { LoopCommand } from './loop.command.js';

export interface StartCommandOptions {
	id?: string;
	project?: string;
	trust?: boolean;
	sandbox?: boolean;
	verbose?: boolean;
	// Flags of the old `start`, kept only to say what replaces them
	dryRun?: boolean;
	force?: boolean;
	statusUpdate?: boolean;
	format?: string;
}

/** The old `start` flag a run used, if any: `loop` has no equivalent */
export function removedStartFlag(
	options: StartCommandOptions
): string | undefined {
	if (options.dryRun) return '--dry-run';
	if (options.force) return '--force';
	if (options.statusUpdate === false) return '--no-status-update';
	if (options.format !== undefined) return '--format';
	return undefined;
}

/**
 * The `loop` arguments `start` stands for: one iteration, on the task given
 * (or on the next task when none is).
 */
export function startToLoopArgs(
	taskId: string | undefined,
	options: StartCommandOptions
): string[] {
	const id = taskId ?? options.id;
	return [
		'-n',
		'1',
		...(id !== undefined ? ['--id', id] : []),
		...(options.project !== undefined ? ['--project', options.project] : []),
		...(options.trust ? ['--trust'] : []),
		...(options.sandbox ? ['--sandbox'] : []),
		...(options.verbose ? ['--verbose'] : [])
	];
}

export class StartCommand extends Command {
	constructor(name?: string) {
		super(name || 'start');

		this.description('Deprecated: use taskgraph loop -n 1 --id <id>')
			.argument('[id]', 'Task or subtask ID')
			.option('-i, --id <id>', 'Task or subtask ID')
			.option('-p, --project <path>', 'Project root directory')
			.option('--trust', 'Run Claude without permission prompts')
			.option('--sandbox', 'Run Claude in Docker sandbox mode')
			.option('-v, --verbose', "Show Claude's work in real-time")
			.addOption(new Option('--dry-run').hideHelp())
			.addOption(new Option('--force').hideHelp())
			.addOption(new Option('--no-status-update').hideHelp())
			.addOption(new Option('-f, --format <format>').hideHelp())
			.action((taskId: string | undefined, options: StartCommandOptions) =>
				this.execute(taskId, options)
			);
	}

	private async execute(
		taskId: string | undefined,
		options: StartCommandOptions
	): Promise<void> {
		const id = taskId ?? options.id;
		const removed = removedStartFlag(options);
		if (removed) {
			printError(
				`start ${removed} is gone; start now runs taskgraph loop -n 1 --id <id>`,
				`Run \`taskgraph show ${id ?? '<id>'}\` to see a task without starting it`
			);
			process.exitCode = 1;
			return;
		}
		console.error(formatStartDeprecation(id));
		await new LoopCommand().parseAsync(startToLoopArgs(taskId, options), {
			from: 'user'
		});
	}

	/** Register on a program, left out of help and Tab completion */
	static register(program: Command, name?: string): StartCommand {
		const startCommand = new StartCommand(name);
		program.addCommand(startCommand, { hidden: true });
		return startCommand;
	}
}
