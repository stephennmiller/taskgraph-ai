/**
 * @fileoverview `taskgraph completion`: print a Tab-completion script
 * for bash, zsh or fish, built from the commands this version has.
 */

import chalk from 'chalk';
import { Argument, Command } from 'commander';
import {
	detectShell,
	installSteps,
	isShell,
	renderCompletionScript,
	SHELLS,
	type Shell
} from '../completion/scripts.js';
import { buildCompletionSpec } from '../completion/spec.js';
import { theme } from '../ui/theme.js';
import { displayError } from '../utils/error-handler.js';

export interface CompletionCommandOptions {
	script?: boolean;
}

export class CompletionCommand extends Command {
	constructor(name?: string) {
		super(name || 'completion');

		this.description('Set up Tab completion for bash, zsh or fish')
			.addArgument(
				new Argument('[shell]', 'Shell to complete for').choices(SHELLS)
			)
			.option('--script', 'Print the script even when writing to a terminal')
			.addHelpText(
				'after',
				[
					'',
					'Examples:',
					'  taskgraph completion                 # how to install for your shell',
					'  taskgraph completion zsh > ~/.taskgraph-completion.zsh',
					'  taskgraph completion fish > ~/.config/fish/completions/taskgraph.fish'
				].join('\n')
			)
			.action(
				(shell: string | undefined, options: CompletionCommandOptions) => {
					this.executeCommand(shell, options);
				}
			);
	}

	private executeCommand(
		shellArg: string | undefined,
		options: CompletionCommandOptions
	): void {
		try {
			const shell = this.resolveShell(shellArg);
			if (process.stdout.isTTY && !options.script) {
				this.displayInstructions(shell);
				return;
			}
			const root = this.rootProgram();
			const script = renderCompletionScript(
				shell,
				buildCompletionSpec(root),
				root.version() || 'unknown'
			);
			process.stdout.write(script);
		} catch (error: unknown) {
			displayError(error, { skipExit: true });
			process.exit(1);
		}
	}

	private resolveShell(shellArg: string | undefined): Shell {
		if (shellArg) {
			if (!isShell(shellArg)) {
				throw new Error(
					`Unsupported shell: ${shellArg}. Choose one of: ${SHELLS.join(', ')}`
				);
			}
			return shellArg;
		}
		const detected = detectShell();
		if (!detected) {
			throw new Error(
				`Couldn't tell which shell you use. Run taskgraph completion <shell> with one of: ${SHELLS.join(', ')}`
			);
		}
		return detected;
	}

	private rootProgram(): Command {
		let cmd: Command = this;
		while (cmd.parent) cmd = cmd.parent;
		return cmd;
	}

	private displayInstructions(shell: Shell): void {
		console.log();
		console.log(chalk.bold(`Tab completion for ${shell}`));
		console.log();
		for (const step of installSteps(shell)) {
			console.log(`  ${theme.brand(step)}`);
		}
		console.log();
		console.log(
			theme.muted(
				'Then open a new terminal. Tab completes commands, flags, task IDs, tags and statuses.'
			)
		);
		console.log(
			theme.muted('Run the first command again after upgrading TaskGraph.')
		);
	}

	static register(program: Command, name?: string): CompletionCommand {
		const command = new CompletionCommand(name);
		program.addCommand(command);
		return command;
	}
}
