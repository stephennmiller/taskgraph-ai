/**
 * @fileoverview add_task MCP tool
 * Add a task, written by the AI from a prompt or given as a title and
 * description, through tm-core's tasks.add()
 */

import path from 'node:path';
import { TASKGRAPH_TASKS_FILE } from '@tm/core';
import type { FastMCP } from 'fastmcp';
import { z } from 'zod';
import type { ToolContext } from '../../shared/types.js';
import {
	createErrorResponse,
	handleApiResult,
	withToolContext
} from '../../shared/utils.js';

// The schema clients see; kept as the legacy tool had it, `file` included
const AddTaskSchema = z.object({
	prompt: z
		.string()
		.optional()
		.describe(
			'Description of the task to add (required if not using manual fields)'
		),
	title: z
		.string()
		.optional()
		.describe('Task title (for manual task creation)'),
	description: z
		.string()
		.optional()
		.describe('Task description (for manual task creation)'),
	details: z
		.string()
		.optional()
		.describe('Implementation details (for manual task creation)'),
	testStrategy: z
		.string()
		.optional()
		.describe('Test strategy (for manual task creation)'),
	dependencies: z
		.string()
		.optional()
		.describe('Comma-separated list of task IDs this task depends on'),
	discoveredFrom: z
		.string()
		.optional()
		.describe(
			'ID of the task you found this work while doing; links them without blocking the new task'
		),
	priority: z.string().optional().describe('Task priority (high, medium, low)'),
	file: z
		.string()
		.optional()
		.describe(
			'Path to the tasks file; only .taskgraph/tasks/tasks.json is accepted, so leave it out'
		),
	projectRoot: z
		.string()
		.describe('The directory of the project. Must be an absolute path.'),
	tag: z.string().optional().describe('Tag context to operate on'),
	research: z
		.boolean()
		.optional()
		.describe('Whether to use research capabilities for task creation'),
	acceptanceCriteria: z
		.array(z.string())
		.optional()
		.describe(
			'Acceptance criteria, stored unchecked; set_task_status refuses done until they are checked'
		)
});

type AddTaskArgs = z.infer<typeof AddTaskSchema>;

/**
 * Register the add_task tool with the MCP server
 */
export function registerAddTaskTool(server: FastMCP) {
	server.addTool({
		name: 'add_task',
		description: 'Add a new task using AI',
		parameters: AddTaskSchema,
		annotations: {
			title: 'Add Task',
			destructiveHint: false
		},
		execute: withToolContext(
			async (args: AddTaskArgs, { log, session, tmCore }: ToolContext) => {
				const { projectRoot } = args;
				const tag = args.tag || tmCore.config.getActiveTag();
				log.info(`Starting add-task with args: ${JSON.stringify(args)}`);

				// tm-core writes the project's tasks.json; any other file is refused
				if (
					args.file &&
					path.resolve(projectRoot, args.file) !==
						path.join(projectRoot, TASKGRAPH_TASKS_FILE)
				) {
					return createErrorResponse(
						`add_task writes only ${TASKGRAPH_TASKS_FILE}, not ${args.file}; leave out file`
					);
				}

				try {
					const isManual = Boolean(args.title && args.description);
					const result = await tmCore.tasks.add(
						{
							// Manual fields win over a prompt, as before
							prompt: isManual ? undefined : args.prompt,
							title: args.title,
							description: args.description,
							details: args.details,
							testStrategy: args.testStrategy,
							dependencies: args.dependencies
								?.split(',')
								.map((id) => id.trim())
								.filter(Boolean),
							discoveredFrom: args.discoveredFrom,
							priority: args.priority,
							research: isManual ? false : args.research,
							acceptanceCriteria: args.acceptanceCriteria,
							tag,
							session,
							outputType: 'mcp'
						},
						{
							onWarning: (message) => log.warn(message),
							onDebug: (message) => log.debug(message)
						}
					);
					// The reply has always given the ID as a number
					const taskId = Number(result.task.id);
					return handleApiResult({
						result: {
							success: true,
							data: {
								taskId,
								message: `Successfully added new task #${taskId}`,
								telemetryData: result.telemetryData,
								tagInfo: result.tagInfo
							}
						},
						log,
						errorPrefix: 'Error adding task',
						projectRoot,
						tag
					});
				} catch (error: unknown) {
					const err = error instanceof Error ? error : new Error(String(error));
					// The fix tm-core suggests, e.g. how to list task IDs
					const hint = (err as { hint?: unknown }).hint;
					const message =
						typeof hint === 'string' ? `${err.message}. ${hint}` : err.message;
					log.error(`add_task failed: ${message}`);
					return handleApiResult({
						result: { success: false, error: { message } },
						log,
						errorPrefix: 'Error adding task',
						projectRoot,
						tag
					});
				}
			}
		)
	});
}
