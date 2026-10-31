/**
 * @fileoverview set-task-status MCP tool
 * Set the status of one or more tasks or subtasks
 */

import { z } from 'zod';
import { handleApiResult, withToolContext } from '../../shared/utils.js';
import type { ToolContext } from '../../shared/types.js';
import {
	TASK_STATUSES,
	taskIdsSchema,
	parseTaskIds,
	getUncheckedCriteria,
	neutralizeTaskData,
	TASK_DATA_NOTE,
	type TaskStatus
} from '@tm/core';
import type { FastMCP } from 'fastmcp';

const SetTaskStatusSchema = z.object({
	id: taskIdsSchema.describe(
		"Task ID or subtask ID (e.g., '15', '15.2'). Can be comma-separated to update multiple tasks/subtasks at once."
	),
	status: z
		.enum(TASK_STATUSES as unknown as [string, ...string[]])
		.optional()
		.describe(
			"New status to set (e.g., 'pending', 'done', 'in-progress', 'review', 'deferred', 'cancelled'). Optional when only checking criteria."
		),
	check: z
		.array(z.number().int().positive())
		.optional()
		.describe(
			"Checklist items to check off, by number. A task's acceptance criteria are numbered from 1 in the order get_task lists them, then the project's Definition of Done items follow (top-level tasks only); a refused done lists every unchecked item with its number. Needs a single task ID. Applied before the status."
		),
	uncheck: z
		.array(z.number().int().positive())
		.optional()
		.describe(
			'Checklist items to clear again, by number (same numbering as check). Needs a single task ID.'
		),
	force: z
		.boolean()
		.optional()
		.describe(
			'Set done even while acceptance criteria or Definition of Done items are unchecked.'
		),
	projectRoot: z
		.string()
		.describe('The directory of the project. Must be an absolute path.'),
	tag: z.string().optional().describe('Optional tag context to operate on')
});

type SetTaskStatusArgs = z.infer<typeof SetTaskStatusSchema>;

/**
 * Register the set_task_status tool with the MCP server
 */
export function registerSetTaskStatusTool(server: FastMCP) {
	server.addTool({
		name: 'set_task_status',
		description: 'Set the status of one or more tasks or subtasks.',
		parameters: SetTaskStatusSchema,
		annotations: {
			title: 'Set Task Status',
			destructiveHint: true
		},
		execute: withToolContext(
			async (args: SetTaskStatusArgs, { log, tmCore }: ToolContext) => {
				const { id, status, check, uncheck, force, projectRoot, tag } = args;

				try {
					log.info(
						`Setting status of task(s) ${id} to: ${status}${tag ? ` in tag: ${tag}` : ' in current tag'}`
					);

					// Parse and validate task IDs (validation already done by schema, this handles splitting)
					const taskIds = parseTaskIds(id);

					const changesChecklist = Boolean(check?.length || uncheck?.length);
					if (!status && !changesChecklist) {
						throw new Error('Pass a status, criteria to check, or both');
					}
					let checklist;
					if (changesChecklist) {
						if (taskIds.length !== 1) {
							throw new Error('check and uncheck take one task ID');
						}
						checklist = await tmCore.tasks.updateChecklist(
							taskIds[0],
							{ check, uncheck },
							tag
						);
					}

					// One write for every id: a missing id or a refused done saves none
					const results = status
						? (
								await tmCore.tasks.updateStatuses(
									taskIds,
									status as TaskStatus,
									tag,
									{ force }
								)
							).updated
						: [];

					for (const result of results) {
						log.info(
							`Updated task ${result.taskId}: ${result.oldStatus} → ${result.newStatus}`
						);
					}

					const message = status
						? `Successfully updated ${results.length} task(s) to "${status}"`
						: `Updated the checklist of task ${taskIds[0]} (${checklist?.checkedCount ?? 0} of ${checklist?.items.length ?? 0} checked)`;
					log.info(message);

					return handleApiResult({
						result: {
							success: true,
							data: {
								message,
								tasks: results,
								...(checklist && { checklist: neutralizeTaskData(checklist) })
							}
						},
						log,
						projectRoot,
						tag,
						...(checklist && { note: TASK_DATA_NOTE })
					});
				} catch (error: unknown) {
					const err = error instanceof Error ? error : new Error(String(error));
					log.error(`Error in set-task-status: ${err.message}`);
					if (err.stack) {
						log.debug(err.stack);
					}
					// A refused done names what is left and how to clear it
					const gate = getUncheckedCriteria(error);
					const message = gate
						? [
								`${err.message}:`,
								...gate.unchecked.map(
									(item) => `  ${item.number}. ${neutralizeTaskData(item.text)}`
								),
								`Check them with check: [${gate.unchecked.map((item) => item.number).join(', ')}], or pass force: true`
							].join('\n')
						: `Failed to set task status: ${err.message}`;
					return handleApiResult({
						result: {
							success: false,
							error: { message }
						},
						log,
						projectRoot,
						tag
					});
				}
			}
		)
	});
}
