/**
 * @fileoverview `remove-task`, `remove-subtask` and `clear-subtasks`: thin
 * layers over tm-core's tasks.previewTaskRemoval, removeTasks,
 * removeSubtasks and clearSubtasks.
 */

import { splitIds, type TaskRemovalPreview, type TmCore } from '@tm/core';
import chalk from 'chalk';
import { Command } from 'commander';
import { formatClearedSubtasks } from '../ui/formatters/clear-subtasks-formatters.js';
import { terminalSafe } from '../ui/formatters/markdown-formatters.js';
import { formatTasksRemoved } from '../ui/formatters/remove-task-formatters.js';
import { formatSubtaskRemoved } from '../ui/formatters/subtask-change-formatters.js';
import { theme } from '../ui/theme.js';
import { describeError, printError } from '../utils/error-handler.js';
import { withTmCore } from '../utils/with-tm-core.js';

interface RemovalOptions {
	id?: string;
	all?: boolean;
	convert?: boolean;
	yes?: boolean;
	tag?: string;
	project?: string;
}

/** The options every removal command takes */
function removalCommand(name: string, description: string): Command {
	return new Command(name)
		.description(description)
		.option('--tag <tag>', 'Tag to work in (default: the current tag)')
		.option(
			'-p, --project <path>',
			'Project root directory (auto-detected if not provided)'
		);
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
	const notFound = `${missing.length === 1 ? 'Task' : 'Tasks'} ${missing.map(terminalSafe).join(', ')} not found`;
	// Nothing to remove is a failure: the ID was probably mistyped
	if (found.length === 0) {
		printError(notFound, 'Run `taskgraph list` to see task IDs');
		process.exitCode = 1;
		return;
	}
	if (missing.length > 0) console.warn(chalk.yellow(`${notFound}, skipping`));

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
		printError(
			result.errors.join('\n'),
			'Run `taskgraph list` to see what is left'
		);
		process.exitCode = 1;
		return;
	}
	console.log(formatTasksRemoved(ids, result.danglingDependents, options.tag));
}

export class RemoveTaskCommand {
	static register(program: Command): void {
		const command = removalCommand(
			'remove-task',
			'Remove one or more tasks or subtasks permanently'
		)
			.option(
				'-i, --id <ids>',
				'ID(s) of the task(s) or subtask(s) to remove (e.g., "5", "5.2", or "5,6.1,7")'
			)
			.option('-y, --yes', 'Skip confirmation prompt', false)
			.hook('preAction', (cmd) => {
				if (splitIds(cmd.opts<RemovalOptions>().id ?? '').length === 0) {
					printError(
						'remove-task needs --id, the task to remove',
						'Try `taskgraph remove-task --id=5`'
					);
					process.exit(1);
				}
			})
			.action((options: RemovalOptions) =>
				withTmCore(options, (tmCore) => removeTasks(tmCore, options))
			);
		program.addCommand(command);
	}
}

export class RemoveSubtaskCommand {
	static register(program: Command): void {
		const command = removalCommand(
			'remove-subtask',
			'Remove a subtask from its parent task'
		)
			.option(
				'-i, --id <id>',
				'Subtask ID(s) to remove in format "parentId.subtaskId" (can be comma-separated for multiple subtasks)'
			)
			.option(
				'-c, --convert',
				'Convert the subtask to a standalone task instead of deleting it'
			)
			.action((options: RemovalOptions) => {
				const ids = splitIds(options.id ?? '');
				if (ids.length === 0) {
					printError(
						'remove-subtask needs --id, the subtask to remove',
						'Try `taskgraph remove-subtask --id=5.2`'
					);
					process.exit(1);
				}
				// A task ID gets a pointer to remove-task; tm-core checks the rest
				const taskId = ids.find((id) => !id.includes('.'));
				if (taskId) {
					printError(
						`"${terminalSafe(taskId)}" isn't a subtask ID`,
						`Subtask IDs look like 5.2; for a task, run \`taskgraph remove-task --id=${terminalSafe(taskId)}\``
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
			});
		program.addCommand(command);
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
