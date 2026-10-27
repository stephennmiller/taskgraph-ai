/**
 * @fileoverview update_subtask MCP tool: the AI writes notes for a subtask,
 * appended to its details timestamped, through tm-core's
 * tasks.updateSubtask(). The reply shape is the legacy tool's.
 */

import path from 'node:path';
import {
	neutralizeTaskData,
	TASK_DATA_NOTE,
	TASKGRAPH_TASKS_FILE,
	TaskIdSchema
} from '@tm/core';
import type { FastMCP } from 'fastmcp';
import { z } from 'zod';
import type { ToolContext } from '../../shared/types.js';
import { replyWith } from '../../shared/tool-reply.js';
import {
	createErrorResponse,
	validateMcpMetadata,
	withToolContext
} from '../../shared/utils.js';

// The schema clients see, kept as the legacy tool had it, `file` included
const UpdateSubtaskSchema = z.object({
	id: TaskIdSchema.describe(
		'ID of the subtask to update in format "parentId.subtaskId" (e.g., "5.2"). Parent ID is the ID of the task that contains the subtask.'
	),
	prompt: z
		.string()
		.optional()
		.describe(
			'Information to add to the subtask. Required unless only updating metadata.'
		),
	research: z
		.boolean()
		.optional()
		.describe('Use Claude Code web research for research-backed updates'),
	metadata: z
		.string()
		.optional()
		.describe(
			'JSON string of metadata to merge into subtask metadata. Example: \'{"ticketId": "JIRA-456", "reviewed": true}\'. Requires TASKGRAPH_ALLOW_METADATA_UPDATES=true in MCP environment.'
		),
	file: z.string().optional().describe('Absolute path to the tasks file'),
	projectRoot: z
		.string()
		.describe('The directory of the project. Must be an absolute path.'),
	tag: z.string().optional().describe('Tag context to operate on')
});

type UpdateSubtaskArgs = z.infer<typeof UpdateSubtaskSchema>;

/**
 * Register the update_subtask tool with the MCP server
 */
export function registerUpdateSubtaskTool(server: FastMCP) {
	server.addTool({
		name: 'update_subtask',
		description:
			'Appends timestamped information to a specific subtask without replacing existing content. If you just want to update the subtask status, use set_task_status instead.',
		parameters: UpdateSubtaskSchema,
		annotations: { title: 'Update Subtask', destructiveHint: true },
		execute: withToolContext(
			async (args: UpdateSubtaskArgs, context: ToolContext) => {
				const { tmCore, session, log } = context;
				const tag = args.tag || tmCore.config.getActiveTag();
				const { parsedMetadata, error } = validateMcpMetadata(
					args.metadata,
					createErrorResponse
				);
				if (error) return error;
				if (!args.prompt && !parsedMetadata) {
					return createErrorResponse(
						'Either prompt or metadata must be provided for update-subtask'
					);
				}
				return replyWith(
					{ ...args, tag },
					context,
					'Error updating subtask',
					async () => {
						const result = await tmCore.tasks.updateSubtask(
							{
								id: String(args.id),
								prompt: args.prompt,
								research: args.research === true,
								metadata: parsedMetadata ?? undefined,
								tag,
								session,
								outputType: 'mcp'
							},
							{
								onWarning: (message) => log.warn(message),
								onDebug: (message) => log.debug(message)
							}
						);
						const nothingAdded = Boolean(args.prompt?.trim()) && !result.added;
						if (nothingAdded) {
							log.warn(
								'AI response was empty or whitespace after trimming. Original details remain unchanged.'
							);
						}
						return {
							tag: result.tag,
							note: TASK_DATA_NOTE,
							data: neutralizeTaskData({
								message: nothingAdded
									? `Nothing added to subtask ${result.id}: the AI returned no text${parsedMetadata ? ' (metadata saved)' : ''}`
									: `Successfully updated subtask with ID ${result.id}`,
								updated: !nothingAdded || Boolean(parsedMetadata),
								added: result.added,
								subtaskId: result.id,
								parentId: result.parentId,
								subtask: { ...result.subtask, id: result.id },
								tasksPath: path.join(args.projectRoot, TASKGRAPH_TASKS_FILE),
								useResearch: args.research === true,
								telemetryData: result.telemetryData,
								tagInfo: result.tagInfo
							})
						};
					}
				);
			}
		)
	});
}
