/**
 * @fileoverview get-tasks MCP tool
 * Get all tasks from TaskGraph with optional filtering
 */

import { z } from 'zod';
import { handleApiResult, withToolContext } from '../../shared/utils.js';
import type { ToolContext } from '../../shared/types.js';
import {
	DEFAULT_TASK_FIELDS,
	neutralizeTaskData,
	parseStatusFilter,
	TASK_DATA_NOTE,
	parseTaskFields,
	selectTaskFields,
	withFullSubtaskIds
} from '@tm/core';
import type { FastMCP } from 'fastmcp';

const GetTasksSchema = z.object({
	projectRoot: z
		.string()
		.describe('The directory of the project. Must be an absolute path.'),
	status: z
		.string()
		.optional()
		.describe(
			"Filter tasks by status (e.g., 'pending', 'done') or multiple statuses separated by commas (e.g., 'blocked,deferred')"
		),
	fields: z
		.string()
		.optional()
		.describe(
			`Comma-separated task fields to return (e.g. 'title,details,testStrategy'); id is always returned. Default: ${DEFAULT_TASK_FIELDS.join(',')}. 'all' returns every field`
		),
	withSubtasks: z
		.boolean()
		.optional()
		.describe(
			'Include subtasks nested within their parent tasks, with the same fields'
		),
	tag: z.string().optional().describe('Tag context to operate on')
});

type GetTasksArgs = z.infer<typeof GetTasksSchema>;

/**
 * Register the get_tasks tool with the MCP server
 */
export function registerGetTasksTool(server: FastMCP) {
	server.addTool({
		name: 'get_tasks',
		description:
			'List tasks as compact JSON: id, title, status, priority and dependencies by default. Ask for more with fields, filter with status, add subtasks with withSubtasks. Use get_task for one task in full.',
		parameters: GetTasksSchema,
		annotations: {
			title: 'Get Tasks',
			readOnlyHint: true
		},
		execute: withToolContext(
			async (args: GetTasksArgs, { log, tmCore }: ToolContext) => {
				const { projectRoot, status, fields, withSubtasks, tag } = args;

				try {
					const selected = parseTaskFields(fields, { withSubtasks });

					log.info(
						`Getting tasks from ${projectRoot}${status ? ` with status filter: ${status}` : ''}${tag ? ` for tag: ${tag}` : ''}`
					);

					const statuses = parseStatusFilter(status);
					const filter = statuses && { status: statuses };

					// Call tm-core tasks.list()
					const result = await tmCore.tasks.list({
						tag,
						filter,
						includeSubtasks: withSubtasks
					});

					log.info(
						`Retrieved ${result.tasks?.length || 0} tasks (${result.filtered} filtered, ${result.total} total)`
					);

					const tasks = result.tasks ?? [];
					return handleApiResult({
						result: {
							success: true,
							data: {
								tasks: neutralizeTaskData(
									selectTaskFields(tasks.map(withFullSubtaskIds), selected)
								),
								filter: status || 'all'
							}
						},
						log,
						projectRoot,
						tag: result.tag,
						minify: true,
						note: TASK_DATA_NOTE
					});
				} catch (error: any) {
					log.error(`Error in get-tasks: ${error.message}`);
					if (error.stack) {
						log.debug(error.stack);
					}
					return handleApiResult({
						result: {
							success: false,
							error: {
								message: `Failed to get tasks: ${error.message}`
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
