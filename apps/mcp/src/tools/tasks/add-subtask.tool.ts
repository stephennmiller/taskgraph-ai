/**
 * @fileoverview add_subtask MCP tool
 * Add a subtask to a task, or turn a task into one
 */

import { fullSubtaskId, neutralizeTaskData, TASK_DATA_NOTE } from '@tm/core';
import type { FastMCP } from 'fastmcp';
import { z } from 'zod';
import type { ToolContext } from '../../shared/types.js';
import { handleApiResult, withToolContext } from '../../shared/utils.js';

const AddSubtaskSchema = z.object({
	id: z.string().describe('Parent task ID (required)'),
	taskId: z
		.string()
		.optional()
		.describe('Existing task ID to convert to subtask'),
	title: z
		.string()
		.optional()
		.describe('Title for the new subtask (when creating a new subtask)'),
	description: z
		.string()
		.optional()
		.describe('Description for the new subtask'),
	details: z
		.string()
		.optional()
		.describe('Implementation details for the new subtask'),
	status: z
		.string()
		.optional()
		.describe("Status for the new subtask (default: 'pending')"),
	dependencies: z
		.string()
		.optional()
		.describe(
			'Comma-separated task or subtask IDs the new subtask depends on, e.g. "3,5.2" (3 is task 3, 5.2 is subtask 2 of task 5)'
		),
	file: z
		.string()
		.optional()
		.describe('Absolute path to the tasks file (default: tasks/tasks.json)'),
	skipGenerate: z.boolean().optional().describe('Skip regenerating task files'),
	projectRoot: z
		.string()
		.describe('The directory of the project. Must be an absolute path.'),
	tag: z.string().optional().describe('Tag context to operate on')
});

type AddSubtaskArgs = z.infer<typeof AddSubtaskSchema>;

/**
 * Register the add_subtask tool with the MCP server
 */
export function registerAddSubtaskTool(server: FastMCP) {
	server.addTool({
		name: 'add_subtask',
		description: 'Add a subtask to an existing task',
		parameters: AddSubtaskSchema,
		annotations: {
			title: 'Add Subtask',
			destructiveHint: true
		},
		execute: withToolContext(
			async (args: AddSubtaskArgs, { log, tmCore }: ToolContext) => {
				const { id, taskId, projectRoot } = args;
				const tag = args.tag || tmCore.config.getActiveTag();
				try {
					const { subtask } = await tmCore.tasks.addSubtask(
						id,
						taskId
							? { fromTaskId: taskId }
							: {
									title: args.title,
									description: args.description,
									details: args.details,
									status: args.status,
									dependencies: args.dependencies
								},
						{ tag }
					);
					const parentId = parseInt(id, 10);
					return handleApiResult({
						result: {
							success: true,
							data: neutralizeTaskData({
								message: taskId
									? `Task ${parseInt(taskId, 10)} successfully converted to a subtask of task ${parentId}`
									: `New subtask ${parentId}.${subtask.id} successfully created`,
								subtask: { ...subtask, id: fullSubtaskId(parentId, subtask.id) }
							})
						},
						log,
						projectRoot,
						tag,
						note: TASK_DATA_NOTE
					});
				} catch (error: any) {
					return handleApiResult({
						result: { success: false, error: { message: error.message } },
						log,
						errorPrefix: 'Error adding subtask',
						projectRoot,
						tag
					});
				}
			}
		)
	});
}
