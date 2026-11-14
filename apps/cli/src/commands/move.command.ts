/**
 * @fileoverview `taskgraph move`: move tasks or subtasks to new IDs within a
 * tag, or tasks to another tag. Thin layer over tm-core's tasks.move() and
 * tasks.moveToTag().
 */

import {
	type CrossTagConflict,
	MOVE_ERROR_CODES,
	createTmCore
} from '@tm/core';
import { Command } from 'commander';
import { projectOption, tagOption } from '../utils/shared-options.js';
import {
	formatCrossTagConflictHint,
	formatCrossTagConflicts,
	formatMoves,
	formatTagMove
} from '../ui/formatters/move-formatters.js';
import { terminalSafe } from '../ui/formatters/markdown-formatters.js';
import { displayError, printError } from '../utils/error-handler.js';
import { pickValue } from '../utils/id-argument.js';
import { getProjectRoot } from '../utils/project-root.js';
import {
	legacyFileOption,
	otherTasksFileError
} from '../utils/tasks-file-option.js';

interface MoveOptions {
	from?: string;
	to?: string;
	tag?: string;
	fromTag?: string;
	toTag?: string;
	withDependencies?: boolean;
	ignoreDependencies?: boolean;
	project?: string;
	file?: string;
}

export class MoveCommand extends Command {
	constructor(name?: string) {
		super(name || 'move');

		this.description('Move tasks to another position or tag')
			.argument(
				'[from]',
				'Task or subtask to move (5 or 5.2); several with commas (5,6,7)'
			)
			.argument('[to]', 'The ID it gets (7 or 7.3); one for each one moved')
			.option('--from <id>', 'The same as the [from] argument')
			.option('--to <id>', 'The same as the [to] argument')
			.addOption(tagOption())
			.option('--from-tag <tag>', 'Tag to move the tasks out of')
			.option('--to-tag <tag>', 'Tag to move the tasks into')
			.option('--with-dependencies', 'Also move the tasks they depend on')
			.option(
				'--ignore-dependencies',
				'Drop dependencies that would cross tags'
			)
			.addOption(projectOption())
			.addOption(legacyFileOption())
			.action(
				(
					from: string | undefined,
					to: string | undefined,
					options: MoveOptions
				) =>
					this.execute({
						...options,
						from: pickValue(
							from,
							options.from,
							{ name: 'the task to move', flag: '--from' },
							'move'
						),
						to: pickValue(
							to,
							options.to,
							{ name: 'the new ID', flag: '--to' },
							'move'
						)
					})
			);
	}

	private async execute(options: MoveOptions): Promise<void> {
		const { from, to } = options;
		const fileError = otherTasksFileError(
			options.file,
			'add-subtask and move',
			options.project
		);
		if (fileError) displayError(fileError);
		try {
			const tmCore = await createTmCore({
				projectPath: getProjectRoot(options.project)
			});
			const { fromTag, toTag } = tmCore.tasks.moveTags(options);

			if (toTag) {
				if (!from) {
					printError(
						'A move to another tag needs the tasks to move',
						`Try \`taskgraph move 5 --to-tag=${terminalSafe(toTag)}\``
					);
					process.exit(1);
				}
				const result = await tmCore.tasks.moveToTag(
					from.split(',').map((id) => id.trim()),
					fromTag,
					toTag,
					{
						withDependencies: options.withDependencies,
						ignoreDependencies: options.ignoreDependencies
					}
				);
				console.log(
					formatTagMove(result.movedTasks, fromTag, toTag, Boolean(result.tips))
				);
				return;
			}

			if (!from || !to) {
				printError(
					'move needs the task to move and its new ID',
					'Try `taskgraph move 5 7`, or `--to-tag=<tag>` to move to another tag'
				);
				process.exit(1);
			}
			const result = await tmCore.tasks.move(from, to, { tag: fromTag });
			console.log(formatMoves(result.moves, result.skipped));
		} catch (error: any) {
			const details = error?.context?.details ?? {};
			if (
				details.moveCode === MOVE_ERROR_CODES.CROSS_TAG_DEPENDENCY_CONFLICTS
			) {
				const conflicts: CrossTagConflict[] = details.conflicts;
				const moveTo = terminalSafe(
					`--from=${details.taskIds.join(',')} --from-tag=${details.sourceTag} --to-tag=${details.targetTag}`
				);
				printError(
					`Can't move tasks from "${details.sourceTag}" to "${details.targetTag}": ${conflicts.length} ${conflicts.length === 1 ? 'dependency conflict' : 'dependency conflicts'}\n${formatCrossTagConflicts(conflicts)}`,
					formatCrossTagConflictHint(conflicts, moveTo, details.sourceTag)
				);
				process.exit(1);
			}
			if (details.moveCode === MOVE_ERROR_CODES.CANNOT_MOVE_SUBTASK) {
				printError(
					`Subtask ${details.taskId} can't move to another tag on its own`,
					`Make it a task first: \`taskgraph remove-task ${terminalSafe(details.taskId)} --convert\``
				);
				process.exit(1);
			}
			displayError(error, {
				hint:
					details.moveCode === MOVE_ERROR_CODES.TASK_ALREADY_EXISTS
						? 'Run `taskgraph list` to see which IDs are taken'
						: undefined
			});
		}
	}

	static register(program: Command, name?: string): MoveCommand {
		const command = new MoveCommand(name);
		program.addCommand(command);
		return command;
	}
}
