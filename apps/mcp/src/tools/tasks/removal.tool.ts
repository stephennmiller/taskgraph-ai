/**
 * @fileoverview remove_task, remove_subtask and clear_subtasks MCP tools:
 * thin layers over tm-core's tasks.removeTasks, removeSubtasks and
 * clearSubtasks.
 */

import { neutralizeTaskData, TASK_DATA_NOTE } from '@tm/core';
import type { FastMCP } from 'fastmcp';
import { z } from 'zod';
import { replyId, replyWith } from '../../shared/tool-reply.js';
import type { ToolContext } from '../../shared/types.js';
import { withToolContext } from '../../shared/utils.js';

const projectRoot = z
	.string()
	.describe('The directory of the project. Must be an absolute path.');
const file = z
	.string()
	.optional()
	.describe('Absolute path to the tasks file (default: tasks/tasks.json)');
const tag = z.string().optional().describe('Tag context to operate on');

const RemoveTaskSchema = z.object({
	id: z
		.string()
		.describe(
			"ID of the task or subtask to remove (e.g., '5' or '5.2'). Can be comma-separated to update multiple tasks/subtasks at once."
		),
	file: z.string().optional().describe('Absolute path to the tasks file'),
	projectRoot,
	confirm: z
		.boolean()
		.optional()
		.describe('Whether to skip confirmation prompt (default: false)'),
	tag: z
		.string()
		.optional()
		.describe(
			'Specify which tag context to operate on. Defaults to the current active tag.'
		)
});

export function registerRemoveTaskTool(server: FastMCP) {
	server.addTool({
		name: 'remove_task',
		description: 'Remove a task or subtask permanently from the tasks list',
		parameters: RemoveTaskSchema,
		annotations: { title: 'Remove Task', destructiveHint: true },
		execute: withToolContext(
			async (args: z.infer<typeof RemoveTaskSchema>, context: ToolContext) =>
				replyWith(args, context, 'Error removing task', async () => {
					const result = await context.tmCore.tasks.removeTasks(args.id, {
						tag: args.tag
					});
					if (result.errors.length > 0)
						throw new Error(result.errors.join('\n'));
					const total = args.id.split(',').length;
					const dangling = result.danglingDependents;
					return {
						tag: result.tag,
						note: TASK_DATA_NOTE,
						data: neutralizeTaskData({
							totalTasks: total,
							successful: result.removedTasks.length,
							failed: total - result.removedTasks.length,
							removedTasks: result.removedTasks,
							message: result.messages.join('\n'),
							tasksPath: result.tasksPath,
							tag: result.tag,
							...(dangling > 0 && {
								hint: `${dangling === 1 ? '1 task depends' : `${dangling} tasks depend`} on missing tasks. Run: taskgraph fix-dependencies --tag ${result.tag}`
							})
						})
					};
				})
		)
	});
}

const RemoveSubtaskSchema = z.object({
	id: z
		.string()
		.describe("Subtask ID to remove in format 'parentId.subtaskId' (required)"),
	convert: z
		.boolean()
		.optional()
		.describe(
			'Convert the subtask to a standalone task instead of deleting it'
		),
	file,
	skipGenerate: z.boolean().optional().describe('Skip regenerating task files'),
	projectRoot,
	tag
});

export function registerRemoveSubtaskTool(server: FastMCP) {
	server.addTool({
		name: 'remove_subtask',
		description: 'Remove a subtask from its parent task',
		parameters: RemoveSubtaskSchema,
		annotations: { title: 'Remove Subtask', destructiveHint: true },
		execute: withToolContext(
			async (args: z.infer<typeof RemoveSubtaskSchema>, context: ToolContext) =>
				replyWith(args, context, 'Error removing subtask', async () => {
					const {
						converted: [task],
						tag: usedTag
					} = await context.tmCore.tasks.removeSubtasks([args.id], {
						tag: args.tag,
						convert: args.convert === true
					});
					return {
						tag: usedTag,
						...(task && { note: TASK_DATA_NOTE }),
						data: neutralizeTaskData(
							task
								? {
										message: `Subtask ${args.id} successfully converted to task #${task.id}`,
										task
									}
								: { message: `Subtask ${args.id} successfully removed` }
						)
					};
				})
		)
	});
}

const ClearSubtasksSchema = z
	.object({
		id: z
			.string()
			.optional()
			.describe('Task IDs (comma-separated) to clear subtasks from'),
		all: z.boolean().optional().describe('Clear subtasks from all tasks'),
		file,
		projectRoot,
		tag
	})
	.refine((data) => data.id || data.all, {
		message: "Either 'id' or 'all' parameter must be provided",
		path: ['id', 'all']
	});

export function registerClearSubtasksTool(server: FastMCP) {
	server.addTool({
		name: 'clear_subtasks',
		description: 'Clear subtasks from specified tasks',
		parameters: ClearSubtasksSchema,
		annotations: { title: 'Clear Subtasks', destructiveHint: true },
		execute: withToolContext(
			async (args: z.infer<typeof ClearSubtasksSchema>, context: ToolContext) =>
				replyWith(args, context, 'Error clearing subtasks', async () => {
					const {
						cleared,
						empty,
						tag: usedTag
					} = await context.tmCore.tasks.clearSubtasks(
						args.all ? 'all' : (args.id as string),
						{ tag: args.tag }
					);
					if (args.all && cleared.length + empty.length === 0) {
						throw new Error(`No tasks found in tag context '${usedTag}'`);
					}
					const count = cleared.reduce((sum, t) => sum + t.count, 0);
					return {
						tag: usedTag,
						note: TASK_DATA_NOTE,
						data: neutralizeTaskData({
							message:
								cleared.length > 0
									? `Cleared ${count} subtask(s) from ${cleared.length} task(s) in tag '${usedTag}'`
									: `No subtasks to clear in tag '${usedTag}'`,
							tasksCleared: cleared.map(({ id, title, count }) => ({
								id: replyId(id),
								title,
								subtasksCleared: count
							})),
							tasksWithoutSubtasks: empty.map(({ id, title }) => ({
								id: replyId(id),
								title
							})),
							tag: usedTag
						})
					};
				})
		)
	});
}
