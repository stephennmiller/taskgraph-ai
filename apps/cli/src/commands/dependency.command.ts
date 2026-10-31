/**
 * @fileoverview `depend` and `fix-dependencies [--check]`: thin layers over
 * tm-core's tasks.addDependency, removeDependency, validateDependencies and
 * fixDependencies. `add-dependency`, `remove-dependency` and
 * `validate-dependencies` stay as hidden aliases for scripts (#882).
 */

import { sanitizeForTerminal } from '@tm/core';
import chalk from 'chalk';
import { Command } from 'commander';
import {
	formatDependencyCheck,
	formatDependencyFixes
} from '../ui/formatters/dependency-check-formatters.js';
import { formatPrdCoverage } from '../ui/formatters/prd-coverage-formatters.js';
import { theme } from '../ui/theme.js';
import { printError } from '../utils/error-handler.js';
import { withTmCore } from '../utils/with-tm-core.js';

interface DependencyOptions {
	id?: string;
	dependsOn?: string;
	type?: string;
	remove?: boolean;
	check?: boolean;
	tag?: string;
	project?: string;
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
		.argument('[id]', idHelp)
		.argument('[dependsOn]', dependsOnHelp)
		.option('-i, --id <id>', idHelp)
		.option('-d, --depends-on <id>', dependsOnHelp)
		.option('--tag <tag>', 'Tag to work in (default: the current tag)')
		.option(
			'-p, --project <path>',
			'Project root directory (auto-detected if not provided)'
		)
		.hook('preAction', (command) => {
			// `depend 3 1` and `depend --id=3 --depends-on=1` mean the same
			const [argId, argDependsOn] = command.args;
			const opts = command.opts<DependencyOptions>();
			// Mixing the forms would silently drop one of the IDs typed
			if (argId !== undefined && (opts.id ?? opts.dependsOn) !== undefined) {
				printError(
					'Give the IDs as arguments or as --id and --depends-on, not both',
					`Try \`taskgraph ${name} 3 1\` (task 3 depends on task 1)`
				);
				process.exit(1);
			}
			const id = opts.id ?? argId;
			const dependsOn = opts.dependsOn ?? argDependsOn;
			if (!id || !dependsOn) {
				printError(
					'Say which task depends on which',
					`Try \`taskgraph ${name} 3 1\` (task 3 depends on task 1)`
				);
				process.exit(1);
			}
			command.setOptionValue('id', id);
			command.setOptionValue('dependsOn', dependsOn);
		});
}

const TYPE_HELP =
	'blocks (default), or related / discovered-from to link without blocking';

function addDependency(options: DependencyOptions) {
	return withTmCore(options, async (tmCore) => {
		const result = await tmCore.tasks.addDependency(
			options.id as string,
			options.dependsOn as string,
			{ tag: options.tag, type: options.type }
		);
		printChange(result.changed, result.message);
	});
}

function removeDependency(options: DependencyOptions) {
	return withTmCore(options, async (tmCore) => {
		const result = await tmCore.tasks.removeDependency(
			options.id as string,
			options.dependsOn as string,
			{ tag: options.tag }
		);
		printChange(result.removed, result.message);
	});
}

/** `depend 3 1`: task 3 depends on task 1; `--remove` takes it away */
export class DependCommand {
	static register(program: Command): void {
		const command = editCommand(
			'depend',
			'Make a task depend on another, or --remove the dependency',
			'Task that depends on the other',
			'Task it depends on'
		)
			.option('--remove', 'Remove the dependency or link instead')
			.option('--type <type>', TYPE_HELP)
			.action((_id, _dependsOn, options: DependencyOptions) =>
				options.remove ? removeDependency(options) : addDependency(options)
			);
		program.addCommand(command);
	}
}

/** Hidden alias of `depend` */
export class AddDependencyCommand {
	static register(program: Command): void {
		const command = editCommand(
			'add-dependency',
			'Add a dependency to a task',
			'Task ID to add dependency to',
			'Task ID that will become a dependency'
		)
			.option('--type <type>', TYPE_HELP)
			.action((_id, _dependsOn, options: DependencyOptions) =>
				addDependency(options)
			);
		program.addCommand(command, { hidden: true });
	}
}

/** Hidden alias of `depend --remove` */
export class RemoveDependencyCommand {
	static register(program: Command): void {
		const command = editCommand(
			'remove-dependency',
			'Remove a dependency or a non-blocking link from a task',
			'Task ID to remove dependency from',
			'Task ID to remove as a dependency'
		).action((_id, _dependsOn, options: DependencyOptions) =>
			removeDependency(options)
		);
		program.addCommand(command, { hidden: true });
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

function validateDependencies(options: DependencyOptions) {
	return withTmCore(options, async (tmCore) => {
		const result = await tmCore.tasks.validateDependencies({
			tag: options.tag
		});
		console.log(formatDependencyCheck(result));
		// Which PRD sections have tasks, once parse-prd has recorded sources
		const coverage = formatPrdCoverage(result.prdCoverage);
		if (coverage) console.log(coverage);
		// A check that finds problems fails, so scripts and CI can act on it
		if (!result.valid) process.exitCode = 1;
	});
}

/** Hidden alias of `fix-dependencies --check` */
export class ValidateDependenciesCommand {
	static register(program: Command): void {
		const command = checkCommand(
			'validate-dependencies',
			'Identify invalid dependencies without fixing them'
		).action(validateDependencies);
		program.addCommand(command, { hidden: true });
	}
}

export class FixDependenciesCommand {
	static register(program: Command): void {
		const command = checkCommand(
			'fix-dependencies',
			'Fix invalid dependencies automatically, or --check to only report them'
		)
			.option('--check', 'Report invalid dependencies without fixing them')
			.action((options: DependencyOptions) =>
				options.check
					? validateDependencies(options)
					: withTmCore(options, async (tmCore) => {
							const result = await tmCore.tasks.fixDependencies({
								tag: options.tag
							});
							console.log(formatDependencyFixes(result));
							// Loops between tasks are left for the user; say so in the exit code
							if (result.remaining.length > 0) process.exitCode = 1;
						})
			);
		program.addCommand(command);
	}
}
