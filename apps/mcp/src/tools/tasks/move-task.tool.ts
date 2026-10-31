/**
 * @fileoverview move_task MCP tool
 * Move tasks or subtasks to new IDs within a tag, or tasks to another tag
 */

import {
	type CrossTagConflict,
	crossTagConflictFixes,
	MOVE_ERROR_CODES,
	neutralizeTaskData,
	TASK_DATA_NOTE
} from '@tm/core';
import type { FastMCP } from 'fastmcp';
import { z } from 'zod';
import type { ToolContext } from '../../shared/types.js';
import {
	createErrorResponse,
	handleApiResult,
	withToolContext
} from '../../shared/utils.js';

const MoveTaskSchema = z.object({
	from: z
		.string()
		.describe(
			'ID of the task/subtask to move (e.g., "5" or "5.2"). Can be comma-separated to move multiple tasks (e.g., "5,6,7")'
		),
	to: z
		.string()
		.optional()
		.describe(
			'ID of the destination (e.g., "7" or "7.3"). Required for within-tag moves. For cross-tag moves, if omitted, task will be moved to the target tag maintaining its ID'
		),
	file: z.string().optional().describe('Custom path to tasks.json file'),
	projectRoot: z
		.string()
		.describe('Root directory of the project (typically derived from session)'),
	tag: z.string().optional().describe('Tag context to operate on'),
	fromTag: z.string().optional().describe('Source tag for cross-tag moves'),
	toTag: z.string().optional().describe('Target tag for cross-tag moves'),
	withDependencies: z
		.boolean()
		.optional()
		.describe('Move dependent tasks along with main task'),
	ignoreDependencies: z
		.boolean()
		.optional()
		.describe('Break cross-tag dependencies during move')
});

type MoveTaskArgs = z.infer<typeof MoveTaskSchema>;

/**
 * Why a move to another tag failed. Refused for dependency conflicts, it
 * lists them and says what to retry with, as the CLI does
 */
function moveToTagError(error: any): string {
	const details = error?.context?.details ?? {};
	if (details.moveCode !== MOVE_ERROR_CODES.CROSS_TAG_DEPENDENCY_CONFLICTS) {
		return error.message;
	}
	const conflicts: CrossTagConflict[] = details.conflicts;
	const { moveAlong, restore, missing } = crossTagConflictFixes(conflicts);
	// archive_tasks and fix_dependencies are outside the core and standard
	// tiers, so name the CLI too
	const restoreStep = `archive_tasks with restore: "<id>", tag: "${details.sourceTag}" (if that tool isn't loaded: taskgraph archive restore <id> --tag=${details.sourceTag})`;
	const fixStep = `fix_dependencies with tag: "${details.sourceTag}" (if that tool isn't loaded: taskgraph fix-dependencies --tag=${details.sourceTag})`;
	let hint: string;
	if (moveAlong) {
		hint =
			'Move them too: retry with withDependencies: true (tasks that depend on them go in from), or drop them with ignoreDependencies: true';
		if (restore)
			hint += `. Archived ones can't move until restored: ${restoreStep}`;
	} else if (restore) {
		hint = `Archived tasks can't move: drop them with ignoreDependencies: true, or restore them first with ${restoreStep}`;
	} else {
		hint = `Drop them with ignoreDependencies: true, or remove them first with ${fixStep}`;
	}
	if (missing && (moveAlong || restore)) {
		hint += `. Missing ones can't move; remove them with ${fixStep}`;
	}
	const lines = conflicts.map((conflict) => `  ${conflict.message}`);
	return neutralizeTaskData([error.message, ...lines, hint].join('\n'));
}

/**
 * Register the move_task tool with the MCP server
 */
export function registerMoveTaskTool(server: FastMCP) {
	server.addTool({
		name: 'move_task',
		description: 'Move a task or subtask to a new position',
		parameters: MoveTaskSchema,
		annotations: {
			title: 'Move Task',
			destructiveHint: true
		},
		execute: withToolContext(
			async (args: MoveTaskArgs, { log, tmCore }: ToolContext) => {
				const { from, to, fromTag, toTag, projectRoot } = args;

				if (fromTag && toTag && fromTag !== toTag) {
					if (to) {
						log.warn(
							'The "to" parameter is not used for cross-tag moves and will be ignored. Tasks retain their original IDs in the target tag.'
						);
					}
					const moveOptions = {
						withDependencies: args.withDependencies || false,
						ignoreDependencies: args.ignoreDependencies || false
					};
					try {
						const sourceIds = from.split(',').map((id) => id.trim());
						const result = await tmCore.tasks.moveToTag(
							sourceIds,
							fromTag,
							toTag,
							moveOptions
						);
						return handleApiResult({
							result: {
								success: true,
								data: {
									...result,
									message: `Successfully moved ${sourceIds.length} task(s) from "${fromTag}" to "${toTag}"`,
									moveOptions,
									sourceTag: fromTag,
									targetTag: toTag
								}
							},
							log,
							projectRoot
						});
					} catch (error: any) {
						return handleApiResult({
							result: {
								success: false,
								error: { message: moveToTagError(error) }
							},
							log,
							errorPrefix: 'Error moving tasks between tags',
							projectRoot
						});
					}
				}

				if (!to) {
					return createErrorResponse(
						'Destination ID is required for within-tag moves'
					);
				}
				const tag = args.tag || tmCore.config.getActiveTag();
				try {
					const { moves, skipped } = await tmCore.tasks.move(from, to, { tag });
					const message = `Successfully moved task/subtask ${from} to ${to}`;
					const data =
						// One ID gets the one move; a list gets all of them
						from.includes(',')
							? {
									message,
									moves,
									...(skipped.length > 0 ? { skipped } : {})
								}
							: { ...moves[0], message };
					return handleApiResult({
						result: { success: true, data: neutralizeTaskData(data) },
						log,
						projectRoot,
						tag,
						note: TASK_DATA_NOTE
					});
				} catch (error: any) {
					return handleApiResult({
						result: { success: false, error: { message: error.message } },
						log,
						errorPrefix: 'Error moving task',
						projectRoot,
						tag
					});
				}
			}
		)
	});
}
