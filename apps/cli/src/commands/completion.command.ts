/**
 * @fileoverview `taskgraph completion`: set up Tab completion for bash, zsh
 * or fish, built from the commands this version has.
 */

import chalk from 'chalk';
import { Argument, Command } from 'commander';
import {
	displayPath,
	installCompletion,
	installPaths
} from '../completion/install.js';
import {
	detectShell,
	installSteps,
	renderCompletionScript,
	SHELLS,
	type Shell
} from '../completion/scripts.js';
import { buildCompletionSpec } from '../completion/spec.js';
import { theme } from '../ui/theme.js';
import { displayError } from '../utils/error-handler.js';

export interface CompletionCommandOptions {
	install?: boolean;
	script?: boolean;
}

export class CompletionCommand extends Command {
	constructor(name?: string) {
		super(name || 'completion');

		this.description('Set up Tab completion for bash, zsh or fish')
			.addArgument(
				new Argument(
					'[shell]',
					'Shell to complete for (default: yours)'
				).choices(SHELLS)
			)
			.option(
				'--install',
				'Install it and load it from your shell startup file'
			)
			.option('--script', 'Print the script even when writing to a terminal')
			.addHelpText(
				'after',
				[
					'',
					'Examples:',
					'  taskgraph completion --install       # set it up for your shell',
					'  taskgraph completion zsh > ~/.taskgraph-completion.zsh'
				].join('\n')
			)
			.action(
				(shell: string | undefined, options: CompletionCommandOptions) => {
					this.executeCommand(shell as Shell | undefined, options);
				}
			);
	}

	private executeCommand(
		shellArg: Shell | undefined,
		options: CompletionCommandOptions
	): void {
		try {
			const shell = shellArg ?? this.detectedShell();
			if (options.install) {
				this.install(shell);
			} else if (process.stdout.isTTY && !options.script) {
				this.displayInstructions(shell, !shellArg);
			} else {
				process.stdout.write(this.script(shell));
			}
		} catch (error: unknown) {
			displayError(error, { skipExit: true });
			process.exit(1);
		}
	}

	private detectedShell(): Shell {
		const detected = detectShell();
		if (!detected) {
			throw new Error(
				`Couldn't tell which shell you use. Name it: taskgraph completion <${SHELLS.join('|')}>`
			);
		}
		return detected;
	}

	private script(shell: Shell): string {
		let root: Command = this;
		while (root.parent) root = root.parent;
		return renderCompletionScript(
			shell,
			buildCompletionSpec(root),
			root.version() || 'unknown'
		);
	}

	private install(shell: Shell): void {
		const result = installCompletion(shell, this.script(shell));
		const ok = chalk.green('✓');
		console.log();
		console.log(
			`${ok} ${result.replaced ? 'Updated' : 'Wrote'} ${theme.brand(displayPath(result.script))}`
		);
		if (result.rc && result.rcUpdated) {
			console.log(
				`${ok} Loaded it from ${theme.brand(displayPath(result.rc))}`
			);
		} else if (result.rc) {
			console.log(
				`${ok} ${theme.brand(displayPath(result.rc))} ${theme.muted('already loads it')}`
			);
		}
		console.log();
		console.log(
			`Open a new terminal, then try ${theme.brand('taskgraph show <Tab>')}`
		);
		console.log(
			theme.muted(
				'Run this again after upgrading TaskGraph to pick up new commands.'
			)
		);
	}

	private displayInstructions(shell: Shell, detected: boolean): void {
		const paths = installPaths(shell);
		const target = paths.rc
			? `Writes ${displayPath(paths.script)} and loads it from ${displayPath(paths.rc)}.`
			: `Writes ${displayPath(paths.script)}.`;
		console.log();
		console.log(chalk.bold(`Tab completion for ${shell}`));
		console.log();
		console.log(`  ${theme.brand('taskgraph completion --install')}`);
		console.log(`  ${theme.muted(target)}`);
		console.log();
		console.log(theme.muted('Or by hand:'));
		for (const step of installSteps(shell)) {
			console.log(`  ${step}`);
		}
		if (detected) {
			const others = SHELLS.filter((s) => s !== shell).join('|');
			console.log();
			console.log(
				theme.muted(
					`Not using ${shell}? Name your shell: taskgraph completion <${others}> --install`
				)
			);
		}
	}

	static register(program: Command, name?: string): CompletionCommand {
		const command = new CompletionCommand(name);
		program.addCommand(command);
		return command;
	}
}
