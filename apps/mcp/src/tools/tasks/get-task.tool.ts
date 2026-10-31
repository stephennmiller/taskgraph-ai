/**
 * @fileoverview get-task MCP tool
 * Get detailed information about a specific task by ID
 */

import { z } from 'zod';
import { handleApiResult, withToolContext } from '../../shared/utils.js';
import type { ToolContext } from '../../shared/types.js';
import {
	Subtask,
	taskIdsSchema,
	parseTaskIds,
	neutralizeTaskData,
	TASK_DATA_NOTE,
	type Task,
	withFullSubtaskIds
} from '@tm/core';
import type { FastMCP } from 'fastmcp';

const GetTaskSchema = z.object({
	id: taskIdsSchema.describe(
		'Task ID(s) to get (can be comma-separated for multiple tasks)'
	),
	status: z
		.string()
		.optional()
		.describe("Filter subtasks by status (e.g., 'pending', 'done')"),
	projectRoot: z
		.string()
		.describe(
			'Absolute path to the project root directory (Optional, usually from session)'
		),
	tag: z.string().optional().describe('Tag context to operate on')
});

type GetTaskArgs = z.infer<typeof GetTaskSchema>;

/**
 * Register the get_task tool with the MCP server
 */
export function registerGetTaskTool(server: FastMCP) {
	server.addTool({
		name: 'get_task',
		description: 'Get detailed information about a specific task',
		parameters: GetTaskSchema,
		annotations: {
			title: 'Get Task',
			readOnlyHint: true
		},
		execute: withToolContext(
			async (args: GetTaskArgs, { log, tmCore }: ToolContext) => {
				const { id, status, projectRoot, tag } = args;

				try {
					log.info(
						`Getting task details for ID: ${id}${status ? ` (filtering subtasks by status: ${status})` : ''} in root: ${projectRoot}`
					);

					// Parse and validate task IDs (validation already done by schema, this handles splitting)
					const taskIds = parseTaskIds(id);
					const results = await Promise.all(
						taskIds.map(async (taskId) => ({
							...(await tmCore.tasks.get(taskId, tag)),
							prdSection: await tmCore.tasks.getPrdSection(taskId, tag)
						}))
					);

					const notFound = taskIds.filter((_, i) => !results[i].task);
					const tasks: (Task | Subtask)[] = [];
					for (const { prdSection, ...result } of results) {
						if (!result.task) continue;
						// The PRD section the task cites, as written, like `show` prints
						const task = prdSection
							? { ...result.task, prdSection }
							: result.task;

						// If status filter is provided, filter subtasks (create copy to avoid mutation)
						if (status && task.subtasks) {
							const statusFilters = status
								.split(',')
								.map((s) => s.trim().toLowerCase());
							const filteredSubtasks = task.subtasks.filter((st) =>
								statusFilters.includes(String(st.status).toLowerCase())
							);
							tasks.push({ ...task, subtasks: filteredSubtasks });
						} else {
							tasks.push(task);
						}
					}

					if (tasks.length === 0) {
						log.warn(`No tasks found for ID(s): ${id}`);
						return handleApiResult({
							result: {
								success: false,
								error: {
									message: `No tasks found for ID(s): ${id}`
								}
							},
							log,
							projectRoot,
							tag
						});
					}

					log.info(
						`Successfully retrieved ${tasks.length} task(s) for ID(s): ${id}`
					);

					// Return single task if only one ID was requested, otherwise array
					// Subtask IDs in full ("9.1"), as next_task gives them
					const shown = tasks.map(withFullSubtaskIds);
					const responseData = taskIds.length === 1 ? shown[0] : shown;

					return handleApiResult({
						result: {
							success: true,
							data: neutralizeTaskData(responseData)
						},
						log,
						projectRoot,
						tag,
						note: TASK_DATA_NOTE,
						notFound
					});
				} catch (error: any) {
					log.error(`Error in get-task: ${error.message}`);
					if (error.stack) {
						log.debug(error.stack);
					}
					return handleApiResult({
						result: {
							success: false,
							error: {
								message: `Failed to get task: ${error.message}`
							}
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
