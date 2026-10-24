/**
 * @fileoverview update_task and update MCP tools: rewrite one task, or every
 * unfinished task from an ID on, with the AI through tm-core's
 * tasks.updateWithPrompt() and tasks.updateFrom(). Reply shapes are the
 * legacy tools'.
 */

import path from 'node:path';
import { TASKGRAPH_TASKS_FILE, type UpdateHooks } from '@tm/core';
import type { FastMCP } from 'fastmcp';
import { z } from 'zod';
import type { ToolContext } from '../../shared/types.js';
import { replyId, replyWith } from '../../shared/tool-reply.js';
import {
	createErrorResponse,
	validateMcpMetadata,
	withToolContext
} from '../../shared/utils.js';

// The schemas clients see; kept as the legacy tools had them, `file` included
const UpdateTaskSchema = z.object({
	id: z
		.string()
		.describe(
			"ID of the task (e.g., '15') to update. Subtasks are supported using the update-subtask tool."
		),
	prompt: z
		.string()
		.optional()
		.describe(
			'New information or context to incorporate into the task. Required unless only updating metadata.'
		),
	research: z
		.boolean()
		.optional()
		.describe('Use Claude Code web research for research-backed updates'),
	append: z
		.boolean()
		.optional()
		.describe(
			'Append timestamped information to task details instead of full update'
		),
	metadata: z
		.string()
		.optional()
		.describe(
			'JSON string of metadata to merge into task metadata. Example: \'{"githubIssue": 42, "sprint": "Q1-S3"}\'. Requires TASKGRAPH_ALLOW_METADATA_UPDATES=true in MCP environment.'
		),
	file: z.string().optional().describe('Absolute path to the tasks file'),
	projectRoot: z
		.string()
		.describe('The directory of the project. Must be an absolute path.'),
	tag: z.string().optional().describe('Tag context to operate on')
});

const UpdateSchema = z.object({
	from: z
		.string()
		.describe(
			"Task ID from which to start updating (inclusive). IMPORTANT: This tool uses 'from', not 'id'"
		),
	prompt: z.string().describe('Explanation of changes or new context to apply'),
	research: z
		.boolean()
		.optional()
		.describe('Use Claude Code web research for research-backed updates'),
	file: z
		.string()
		.optional()
		.describe('Path to the tasks file relative to project root'),
	projectRoot: z
		.string()
		.optional()
		.describe('The directory of the project. (Optional, usually from session)'),
	tag: z.string().optional().describe('Tag context to operate on')
});

type UpdateTaskArgs = z.infer<typeof UpdateTaskSchema>;
type UpdateArgs = z.infer<typeof UpdateSchema>;

/**
 * tm-core's warnings, and AI detail with global.debug on, to the client log;
 * warnings also go in `warnings`, since the client may not show the log
 */
const reportTo = (
	{ log }: ToolContext,
	warnings: string[]
): UpdateHooks => ({
	onWarning: (message) => {
		warnings.push(message);
		log.warn(message);
	},
	onDebug: (message) => log.debug(message)
});

const tasksPathOf = (projectRoot: string) =>
	path.join(projectRoot, TASKGRAPH_TASKS_FILE);

/**
 * Register the update_task tool with the MCP server
 */
export function registerUpdateTaskTool(server: FastMCP) {
	server.addTool({
		name: 'update_task',
		description:
			'Updates a single task by ID with new information or context provided in the prompt.',
		parameters: UpdateTaskSchema,
		annotations: { title: 'Update Task', destructiveHint: true },
		execute: withToolContext(
			async (args: UpdateTaskArgs, context: ToolContext) => {
				const { tmCore, session, log } = context;
				const { parsedMetadata, error } = validateMcpMetadata(
					args.metadata,
					createErrorResponse
				);
				if (error) return error;
				if (!args.prompt && !parsedMetadata) {
					return createErrorResponse(
						'Either prompt or metadata must be provided for update-task'
					);
				}
				const tag = args.tag || tmCore.config.getActiveTag();
				const taskId = String(args.id);
				const warnings: string[] = [];
				return replyWith({ ...args, tag }, context, 'Error updating task', async () => {
					const result = await tmCore.tasks.updateWithPrompt(
						{
							id: taskId,
							prompt: args.prompt,
							research: args.research === true,
							append: args.append === true,
							metadata: parsedMetadata,
							tag,
							session,
							outputType: 'mcp'
						},
						reportTo(context, warnings)
					);
					if (args.append && args.prompt && result.appended === '') {
						reportTo(context, warnings).onWarning?.(
							'AI response was empty or whitespace after trimming. Original details remain unchanged.'
						);
					}
					if (result.skipped === 'done') {
						log.warn(
							`Task ${taskId} is already marked as done and cannot be updated`
						);
						return {
							tag,
							data: {
								message: `Task ${taskId} was not updated (likely already completed).`,
								taskId,
								updated: false
							}
						};
					}
					return {
						tag,
						data: {
							message: `Successfully updated task with ID ${taskId} based on the prompt`,
							taskId,
							tasksPath: tasksPathOf(args.projectRoot),
							useResearch: args.research === true,
							updated: true,
							// The legacy rewrite replied with the ID as given; append and
							// metadata-only replied with the task as read (a number ID)
							updatedTask:
								args.prompt && !args.append
									? result.task
									: { ...result.task, id: replyId(result.task.id) },
							telemetryData: result.telemetryData,
							// A metadata-only update makes no AI call; the legacy reply named the tag
							tagInfo: result.tagInfo ?? (result.telemetryData ? undefined : { tag }),
							...(warnings.length > 0 && { warnings })
						}
					};
				});
			}
		)
	});
}

/**
 * Register the update tool with the MCP server
 */
export function registerUpdateTool(server: FastMCP) {
	server.addTool({
		name: 'update',
		description:
			"Update multiple upcoming tasks (with ID >= 'from' ID) based on new context or changes provided in the prompt. Use 'update_task' instead for a single specific task or 'update_subtask' for subtasks.",
		parameters: UpdateSchema,
		annotations: { title: 'Update Tasks', destructiveHint: true },
		execute: withToolContext(
			async (args: UpdateArgs & { projectRoot: string }, context: ToolContext) => {
				const { tmCore, session } = context;
				const tag = args.tag || tmCore.config.getActiveTag();
				const warnings: string[] = [];
				return replyWith({ ...args, tag }, context, 'Error updating tasks', async () => {
					const result = await tmCore.tasks.updateFrom(
						{
							from: args.from,
							prompt: args.prompt,
							research: args.research === true,
							tag,
							session,
							outputType: 'mcp'
						},
						reportTo(context, warnings)
					);
					if (result.sentCount === 0) {
						throw new Error(
							`No tasks to update: none from ${args.from} on are unfinished`
						);
					}
					const count = result.updatedTasks.length;
					return {
						tag,
						data: {
							message: `Successfully updated ${count} tasks.`,
							tasksPath: tasksPathOf(args.projectRoot),
							updatedCount: count,
							telemetryData: result.telemetryData,
							tagInfo: result.tagInfo,
							...(warnings.length > 0 && { warnings })
						}
					};
				});
			}
		)
	});
}
