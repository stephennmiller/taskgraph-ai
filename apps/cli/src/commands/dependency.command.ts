/**
 * @fileoverview `add-dependency`, `remove-dependency`, `validate-dependencies`
 * and `fix-dependencies`: thin layers over tm-core's tasks.addDependency,
 * removeDependency, validateDependencies and fixDependencies.
 */

import { type TmCore, createTmCore, sanitizeForTerminal } from '@tm/core';
import chalk from 'chalk';
import { Command } from 'commander';
import {
	formatDependencyCheck,
	formatDependencyFixes
} from '../ui/formatters/dependency-check-formatters.js';
import { formatPrdCoverage } from '../ui/formatters/prd-coverage-formatters.js';
import { theme } from '../ui/theme.js';
import { displayCommandHeader } from '../utils/display-helpers.js';
import { displayError, printError } from '../utils/error-handler.js';
import { getProjectRoot } from '../utils/project-root.js';

interface DependencyOptions {
	id?: string;
	dependsOn?: string;
	type?: string;
	tag?: string;
	project?: string;
}

/**
 * Run `action` on a TmCore after the `[tag] X` line; any error is printed
 * and exits 1
 */
async function withTmCore(
	options: DependencyOptions,
	action: (tmCore: TmCore) => Promise<void>
): Promise<void> {
	let tmCore: TmCore | undefined;
	try {
		tmCore = await createTmCore({
			projectPath: getProjectRoot(options.project)
		});
		displayCommandHeader({
			tag: options.tag || tmCore.config.getActiveTag(),
			projectRoot: tmCore.projectPath
		});
		await action(tmCore);
	} catch (error: unknown) {
		displayError(error, { skipExit: true });
		process.exitCode = 1;
	} finally {
		await tmCore?.close();
	}
}

/** `✓ Task 3 now depends on task 1`; muted when nothing changed */
function printChange(changed: boolean, message: string): void {
	const safe = sanitizeForTerminal(message);
	console.log(changed ? `${chalk.green('✓')} ${safe}` : theme.muted(safe));
}

/** The options both edit commands take, and the check that both IDs came */
function editCommand(
	name: string,
	description: string,
	idHelp: string,
	dependsOnHelp: string
): Command {
	return new Command(name)
		.description(description)
		.option('-i, --id <id>', idHelp)
		.option('-d, --depends-on <id>', dependsOnHelp)
		.option('--tag <tag>', 'Tag to work in (default: the current tag)')
		.option(
			'-p, --project <path>',
			'Project root directory (auto-detected if not provided)'
		)
		.hook('preAction', (command) => {
			const { id, dependsOn } = command.opts<DependencyOptions>();
			if (!id || !dependsOn) {
				printError(
					'Both --id and --depends-on are required',
					`Try \`taskgraph ${name} --id=3 --depends-on=1\``
				);
				process.exit(1);
			}
		});
}

export class AddDependencyCommand {
	static register(program: Command): void {
		const command = editCommand(
			'add-dependency',
			'Add a dependency to a task',
			'Task ID to add dependency to',
			'Task ID that will become a dependency'
		)
			.option(
				'--type <type>',
				'blocks (default), or related / discovered-from to link without blocking'
			)
			.action((options: DependencyOptions) =>
				withTmCore(options, async (tmCore) => {
					const result = await tmCore.tasks.addDependency(
						options.id as string,
						options.dependsOn as string,
						{ tag: options.tag, type: options.type }
					);
					printChange(result.changed, result.message);
				})
			);
		program.addCommand(command);
	}
}

export class RemoveDependencyCommand {
	static register(program: Command): void {
		const command = editCommand(
			'remove-dependency',
			'Remove a dependency or a non-blocking link from a task',
			'Task ID to remove dependency from',
			'Task ID to remove as a dependency'
		).action((options: DependencyOptions) =>
			withTmCore(options, async (tmCore) => {
				const result = await tmCore.tasks.removeDependency(
					options.id as string,
					options.dependsOn as string,
					{ tag: options.tag }
				);
				printChange(result.removed, result.message);
			})
		);
		program.addCommand(command);
	}
}

/** The options both check commands take */
function checkCommand(name: string, description: string): Command {
	return new Command(name)
		.description(description)
		.option('--tag <tag>', 'Tag to work in (default: the current tag)')
		.option(
			'-p, --project <path>',
			'Project root directory (auto-detected if not provided)'
		);
}

export class ValidateDependenciesCommand {
	static register(program: Command): void {
		const command = checkCommand(
			'validate-dependencies',
			'Identify invalid dependencies without fixing them'
		).action((options: DependencyOptions) =>
			withTmCore(options, async (tmCore) => {
				const result = await tmCore.tasks.validateDependencies({
					tag: options.tag
				});
				console.log(formatDependencyCheck(result));
				// Which PRD sections have tasks, once parse-prd has recorded sources
				const coverage = formatPrdCoverage(result.prdCoverage);
				if (coverage) console.log(coverage);
				// A check that finds problems fails, so scripts and CI can act on it
				if (!result.valid) process.exitCode = 1;
			})
		);
		program.addCommand(command);
	}
}

export class FixDependenciesCommand {
	static register(program: Command): void {
		const command = checkCommand(
			'fix-dependencies',
			'Fix invalid dependencies automatically'
		).action((options: DependencyOptions) =>
			withTmCore(options, async (tmCore) => {
				const result = await tmCore.tasks.fixDependencies({ tag: options.tag });
				console.log(formatDependencyFixes(result));
				// Loops between tasks are left for the user; say so in the exit code
				if (result.remaining.length > 0) process.exitCode = 1;
			})
		);
		program.addCommand(command);
	}
}
