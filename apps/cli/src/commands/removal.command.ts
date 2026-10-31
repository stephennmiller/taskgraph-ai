/**
 * @fileoverview `remove-task` (with `--convert` for subtasks) and
 * `clear-subtasks`: thin layers over tm-core's tasks.previewTaskRemoval,
 * removeTasks, removeSubtasks and clearSubtasks. `remove-subtask` stays as a
 * hidden alias for scripts (#882).
 */

import { splitIds, type TaskRemovalPreview, type TmCore } from '@tm/core';
import chalk from 'chalk';
import { Command, Option } from 'commander';
import { formatClearedSubtasks } from '../ui/formatters/clear-subtasks-formatters.js';
import { terminalSafe } from '../ui/formatters/markdown-formatters.js';
import { formatTasksRemoved } from '../ui/formatters/remove-task-formatters.js';
import { formatSubtaskRemoved } from '../ui/formatters/subtask-change-formatters.js';
import { theme } from '../ui/theme.js';
import {
	describeError,
	displayError,
	printError
} from '../utils/error-handler.js';
import {
	legacyFileOption,
	otherTasksFileError
} from '../utils/tasks-file-option.js';
import { withTmCore } from '../utils/with-tm-core.js';

interface RemovalOptions {
	id?: string;
	all?: boolean;
	convert?: boolean;
	yes?: boolean;
	tag?: string;
	project?: string;
	file?: string;
}

/** The options every removal command takes */
function removalCommand(name: string, description: string): Command {
	return new Command(name)
		.description(description)
		.option('--tag <tag>', 'Tag to work in (default: the current tag)')
		.option(
			'-p, --project <path>',
			'Project root directory (auto-detected if not provided)'
		)
		.addOption(legacyFileOption())
		.hook('preAction', (cmd) => {
			const { file, project } = cmd.opts<RemovalOptions>();
			const fileError = otherTasksFileError(
				file,
				'remove-task and clear-subtasks',
				project
			);
			if (fileError) displayError(fileError);
		});
}

/** The items, the subtasks that go with them and the dependents */
function printRemovalPlan(preview: TaskRemovalPreview): void {
	const { found, subtaskCount, dependents } = preview;
	console.log();
	console.log(
		`${chalk.yellow('⚠')} This will permanently delete ${found.length} item(s):`
	);
	console.log();
	for (const { id, title, parent } of found) {
		const label = `${parent ? 'Subtask' : 'Task'} ${terminalSafe(id)}: ${terminalSafe(title || '(no title)')}`;
		if (!parent) {
			console.log(theme.text.bold(`  ${label}`));
			continue;
		}
		console.log(theme.text(`  ${label}`));
		console.log(
			theme.muted(
				`    (Parent: ${terminalSafe(parent.id)} - ${terminalSafe(parent.title || '(no title)')})`
			)
		);
	}
	if (subtaskCount > 0) {
		console.log(
			chalk.yellow(
				`⚠ This also deletes ${subtaskCount} ${subtaskCount === 1 ? 'subtask' : 'subtasks'}`
			)
		);
	}
	if (dependents.length > 0) {
		console.log(chalk.yellow('⚠ Dependencies on them will be removed:'));
		for (const { id, dependentIds } of dependents) {
			console.log(
				chalk.yellow(
					`  - Task ${terminalSafe(id)}: ${dependentIds.length} dependent tasks (${dependentIds.map(terminalSafe).join(', ')})`
				)
			);
		}
	}
	console.log();
}

async function confirm(message: string): Promise<boolean> {
	const { default: inquirer } = await import('inquirer');
	const { proceed } = await inquirer.prompt<{ proceed: boolean }>([
		{ type: 'confirm', name: 'proceed', message, default: false }
	]);
	return proceed;
}

async function removeTasks(
	tmCore: TmCore,
	options: RemovalOptions
): Promise<void> {
	const preview = await tmCore.tasks.previewTaskRemoval(options.id ?? '', {
		tag: options.tag
	});
	const { found, missing } = preview;
	// One unknown ID refuses the whole list, as MCP and tm-core do: it was
	// probably mistyped, and the rest may have been chosen with it in mind
	if (missing.length > 0) {
		printError(
			`${missing.length === 1 ? 'Task' : 'Tasks'} ${missing.map(terminalSafe).join(', ')} not found; nothing was removed`,
			'Run `taskgraph list` to see task IDs, then retry without the unknown ones'
		);
		process.exitCode = 1;
		return;
	}

	if (!options.yes) {
		// A prompt without a terminal hangs scripts and agents
		if (!process.stdin.isTTY) {
			printError(
				'Removing tasks needs confirmation',
				'Pass `--yes` to remove them without asking'
			);
			process.exitCode = 1;
			return;
		}
		printRemovalPlan(preview);
		const proceed = await confirm(
			chalk.red.bold(
				`Are you sure you want to permanently delete these ${found.length} item(s)?`
			)
		);
		if (!proceed) {
			console.log(theme.brand('Task deletion cancelled.'));
			return;
		}
	}

	const ids = found.map(({ id }) => id);
	const result = await tmCore.tasks.removeTasks(ids.join(','), {
		tag: options.tag
	});
	if (result.errors.length > 0) {
		// The tasks are gone even so; say so, or a retry reports them not found
		printError(
			`Removed ${result.removedTasks.length} of ${ids.length}: ${result.errors.map(terminalSafe).join('\n')}`,
			'Run `taskgraph list` to see what is left'
		);
		process.exitCode = 1;
		return;
	}
	console.log(formatTasksRemoved(ids, result.danglingDependents, options.tag));
}

/** Remove subtasks, or with --convert make them tasks; no prompt, as before */
function removeSubtasks(name: string, options: RemovalOptions) {
	const ids = splitIds(options.id ?? '');
	// A task ID gets a pointer to remove-task; tm-core checks the rest
	const taskId = ids.find((id) => !id.includes('.'));
	if (taskId) {
		printError(
			`"${terminalSafe(taskId)}" isn't a subtask ID`,
			options.convert
				? 'Only subtasks (like 5.2) can be converted to tasks'
				: `Subtask IDs look like 5.2; for a task, run \`taskgraph remove-task ${terminalSafe(taskId)}\``
		);
		process.exit(1);
	}
	if (ids.length === 0) {
		printError(
			`${name} needs the subtask to remove`,
			`Try \`taskgraph ${name} 5.2\``
		);
		process.exit(1);
	}
	return withTmCore(options, async (tmCore) => {
		// One call checks every ID, then removes them all in one save
		const { converted } = await tmCore.tasks.removeSubtasks(ids, {
			tag: options.tag,
			convert: options.convert
		});
		ids.forEach((id, i) => {
			console.log(formatSubtaskRemoved(id, converted[i]));
		});
	});
}

/** `remove-task 5` and `remove-task --id=5` mean the same */
function idArgument(command: Command): Command {
	return command
		.argument('[ids]', 'The same as --id')
		.hook('preAction', (cmd) => {
			const [ids] = cmd.args;
			if (ids === undefined) return;
			// Both would silently drop the IDs given as the argument
			if (cmd.opts<RemovalOptions>().id !== undefined) {
				printError(
					'Give the IDs as an argument or as --id, not both',
					`Try \`taskgraph ${cmd.name()} ${terminalSafe(ids)}\``
				);
				process.exit(1);
			}
			cmd.setOptionValue('id', ids);
		});
}

export class RemoveTaskCommand {
	static register(program: Command): void {
		const command = idArgument(
			removalCommand(
				'remove-task',
				'Remove one or more tasks or subtasks permanently'
			)
		)
			.option(
				'-i, --id <ids>',
				'ID(s) of the task(s) or subtask(s) to remove (e.g., "5", "5.2", or "5,6.1,7")'
			)
			.option(
				'-c, --convert',
				'Make the subtasks standalone tasks instead of deleting them'
			)
			.option('-y, --yes', 'Skip confirmation prompt', false)
			.hook('preAction', (cmd) => {
				if (splitIds(cmd.opts<RemovalOptions>().id ?? '').length === 0) {
					printError(
						'remove-task needs the task to remove',
						'Try `taskgraph remove-task 5`'
					);
					process.exit(1);
				}
			})
			.action((_ids, options: RemovalOptions) =>
				options.convert
					? removeSubtasks('remove-task', options)
					: withTmCore(options, (tmCore) => removeTasks(tmCore, options))
			);
		program.addCommand(command);
	}
}

/** Hidden alias of `remove-task <subtask>` and `remove-task --convert` */
export class RemoveSubtaskCommand {
	static register(program: Command): void {
		const command = idArgument(
			removalCommand('remove-subtask', 'Remove a subtask from its parent task')
		)
			.option(
				'-i, --id <id>',
				'Subtask ID(s) to remove in format "parentId.subtaskId" (can be comma-separated for multiple subtasks)'
			)
			.option(
				'-c, --convert',
				'Convert the subtask to a standalone task instead of deleting it'
			)
			// Task files are written by `generate`; the old flag already did nothing
			.addOption(new Option('--generate').hideHelp())
			.action((_ids, options: RemovalOptions) =>
				removeSubtasks('remove-subtask', options)
			);
		program.addCommand(command, { hidden: true });
	}
}

export class ClearSubtasksCommand {
	static register(program: Command): void {
		const command = removalCommand(
			'clear-subtasks',
			'Clear subtasks from specified tasks'
		)
			.option(
				'-i, --id <ids>',
				'Task IDs (comma-separated) to clear subtasks from'
			)
			.option('--all', 'Clear subtasks from all tasks')
			.action((options: RemovalOptions) => {
				if (!options.id && !options.all) {
					printError(
						'Choose which tasks to clear',
						'Use `--id=<ids>`, such as `--id=3,5`, or `--all`'
					);
					process.exit(1);
				}
				return withTmCore(options, async (tmCore) => {
					try {
						const result = await tmCore.tasks.clearSubtasks(
							options.all ? 'all' : (options.id as string),
							{ tag: options.tag }
						);
						console.log(formatClearedSubtasks(result));
					} catch (error: unknown) {
						const { message, hint } = describeError(error);
						printError(`${message}; nothing was cleared`, hint);
						process.exitCode = 1;
					}
				});
			});
		program.addCommand(command);
	}
}
