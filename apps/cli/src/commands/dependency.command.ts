/**
 * @fileoverview `depend` and `fix-dependencies [--check]`: thin layers over
 * tm-core's tasks.addDependency, removeDependency, validateDependencies and
 * fixDependencies. `add-dependency`, `remove-dependency` and
 * `validate-dependencies` stay as hidden aliases for scripts (#882).
 */

import { sanitizeForTerminal } from '@tm/core';
import chalk from 'chalk';
import { Command } from 'commander';
import { projectOption, tagOption } from '../utils/shared-options.js';
import {
	formatDependencyCheck,
	formatDependencyFixes
} from '../ui/formatters/dependency-check-formatters.js';
import { formatPrdCoverage } from '../ui/formatters/prd-coverage-formatters.js';
import { theme } from '../ui/theme.js';
import { noticeOldAlias } from '../utils/alias-notice.js';
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

/** `✓ Task 3 now depends on task 1`, once per ID; muted when nothing changed */
function printChange(changed: boolean, message: string): void {
	const safe = sanitizeForTerminal(message);
	console.log(changed ? `${chalk.green('✓')} ${safe}` : theme.muted(safe));
}

/** The options both edit commands take, and the check that both IDs came */
function editCommand(
	name: string,
	description: string,
	idHelp: string,
	dependsOnHelp: string,
	/** Set on an old name, so the run says what replaced it */
	replacement?: string
): Command {
	const command = new Command(name)
		.description(description)
		.argument('[id]', idHelp)
		.argument('[dependsOn]', dependsOnHelp)
		.option('-i, --id <id>', idHelp)
		.option('-d, --depends-on <ids>', dependsOnHelp)
		.addOption(tagOption())
		.addOption(projectOption());
	// Before the ID check, which exits: the old name was still what they typed
	if (replacement) noticeOldAlias(command, replacement);
	return command.hook('preAction', (command) => {
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
		for (const r of result.results) printChange(r.changed, r.message);
	});
}

function removeDependency(options: DependencyOptions) {
	return withTmCore(options, async (tmCore) => {
		const result = await tmCore.tasks.removeDependency(
			options.id as string,
			options.dependsOn as string,
			{ tag: options.tag }
		);
		for (const r of result.results) printChange(r.removed, r.message);
	});
}

/** `depend 3 1,2`: task 3 depends on tasks 1 and 2; `--remove` takes them away */
export class DependCommand {
	static register(program: Command): void {
		const command = editCommand(
			'depend',
			'Add or --remove a dependency',
			'Task that depends on the others',
			'Task or comma-separated tasks it depends on (1,2,3)'
		)
			.option('--remove', 'Remove the dependencies or links instead')
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
			'Alias of depend',
			'Task ID to add dependency to',
			'Task ID, or comma-separated IDs, that will become dependencies',
			'depend'
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
			'Alias of depend --remove',
			'Task ID to remove dependency from',
			'Task ID, or comma-separated IDs, to remove as dependencies',
			'depend --remove'
		).action((_id, _dependsOn, options: DependencyOptions) =>
			removeDependency(options)
		);
		program.addCommand(command, { hidden: true });
	}
}

/** The options both check commands take */
function checkCommand(
	name: string,
	description: string,
	/** Set on an old name, so the run says what replaced it */
	replacement?: string
): Command {
	const command = new Command(name)
		.description(description)
		.addOption(tagOption())
		.addOption(projectOption());
	if (replacement) noticeOldAlias(command, replacement);
	return command;
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
			'Alias of fix-dependencies --check',
			'fix-dependencies --check'
		).action(validateDependencies);
		program.addCommand(command, { hidden: true });
	}
}

export class FixDependenciesCommand {
	static register(program: Command): void {
		const command = checkCommand(
			'fix-dependencies',
			'Fix invalid dependencies, or --check'
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
