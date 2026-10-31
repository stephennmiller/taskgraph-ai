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
import {
	formatCrossTagConflictHint,
	formatCrossTagConflicts,
	formatMoves,
	formatTagMove
} from '../ui/formatters/move-formatters.js';
import { terminalSafe } from '../ui/formatters/markdown-formatters.js';
import { displayError, printError } from '../utils/error-handler.js';
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

		this.description(
			'Move tasks between tags or reorder within tags. Supports cross-tag moves with dependency resolution options.'
		)
			.option(
				'--from <id>',
				'ID of the task/subtask to move (e.g., "5" or "5.2"). Can be comma-separated to move multiple tasks (e.g., "5,6,7")'
			)
			.option(
				'--to <id>',
				'ID of the destination (e.g., "7" or "7.3"). Must match the number of source IDs if comma-separated'
			)
			.option('--tag <tag>', 'Specify tag context for task operations')
			.option('--from-tag <tag>', 'Source tag for cross-tag moves')
			.option('--to-tag <tag>', 'Target tag for cross-tag moves')
			.option(
				'--with-dependencies',
				'Move dependent tasks along with main task'
			)
			.option(
				'--ignore-dependencies',
				'Break cross-tag dependencies during move'
			)
			.option(
				'--project <path>',
				'Project root directory (auto-detected if not provided)'
			)
			.addOption(legacyFileOption())
			.action((options: MoveOptions) => this.execute(options));
	}

	private async execute(options: MoveOptions): Promise<void> {
		const { from, to, toTag } = options;
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
			const fromTag =
				options.fromTag || options.tag || tmCore.config.getActiveTag();

			if (toTag && fromTag !== toTag) {
				if (!from) {
					printError(
						'A move to another tag needs --from, the tasks to move',
						`Try \`taskgraph move --from=5 --to-tag=${toTag}\``
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
					formatTagMove(
						result.movedTasks.length,
						fromTag,
						toTag,
						Boolean(result.tips)
					)
				);
				return;
			}

			if (!from || !to) {
				printError(
					'move needs --from and --to',
					'Try `taskgraph move --from=5 --to=7`, or `--to-tag=<tag>` to move to another tag'
				);
				process.exit(1);
			}
			const result = await tmCore.tasks.move(from, to, { tag: options.tag });
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
					`Make it a task first: \`taskgraph remove-subtask --id=${terminalSafe(details.taskId)} --convert\``
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
