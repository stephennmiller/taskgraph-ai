/**
 * @fileoverview expand_task and expand_all MCP tools: break one task, or
 * every pending task, into subtasks through tm-core's tasks.expand() and
 * tasks.expandAll(). Reply shapes are the legacy tools'.
 */

import {
	type ExpandOptions,
	type ExpandTaskHooks,
	neutralizeTaskData,
	TASK_DATA_NOTE,
	withFullSubtaskIds
} from '@tm/core';
import type { FastMCP } from 'fastmcp';
import { z } from 'zod';
import type { ToolContext } from '../../shared/types.js';
import { replyId, replyWith } from '../../shared/tool-reply.js';
import { withToolContext } from '../../shared/utils.js';

// The schemas clients see; kept as the legacy tools had them, `file` included
const ExpandTaskSchema = z.object({
	id: z.string().describe('ID of task to expand'),
	num: z.string().optional().describe('Number of subtasks to generate'),
	research: z
		.boolean()
		.optional()
		.default(false)
		.describe('Use research role for generation'),
	prompt: z
		.string()
		.optional()
		.describe('Additional context for subtask generation'),
	file: z
		.string()
		.optional()
		.describe(
			'Path to the tasks file relative to project root (e.g., tasks/tasks.json)'
		),
	projectRoot: z
		.string()
		.describe('The directory of the project. Must be an absolute path.'),
	force: z
		.boolean()
		.optional()
		.default(false)
		.describe('Force expansion even if subtasks exist'),
	tag: z.string().optional().describe('Tag context to operate on')
});

const ExpandAllSchema = z.object({
	num: z
		.string()
		.optional()
		.describe(
			'Target number of subtasks per task (uses complexity/defaults otherwise)'
		),
	research: z
		.boolean()
		.optional()
		.describe(
			'Enable research-backed subtask generation (web research via Claude Code)'
		),
	prompt: z
		.string()
		.optional()
		.describe('Additional context to guide subtask generation for all tasks'),
	force: z
		.boolean()
		.optional()
		.describe(
			'Force regeneration of subtasks for tasks that already have them'
		),
	file: z
		.string()
		.optional()
		.describe(
			'Absolute path to the tasks file in the /tasks folder inside the project root (default: tasks/tasks.json)'
		),
	projectRoot: z
		.string()
		.optional()
		.describe(
			'Absolute path to the project root directory (derived from session if possible)'
		),
	tag: z.string().optional().describe('Tag context to operate on')
});

type ExpandTaskArgs = z.infer<typeof ExpandTaskSchema>;
type ExpandAllArgs = z.infer<typeof ExpandAllSchema>;

/** tm-core's warnings, and AI detail with global.debug on, to the client log */
const reportTo = ({ log }: ToolContext): ExpandTaskHooks => ({
	onWarning: (message) => log.warn(message),
	onDebug: (message) => log.debug(message)
});

/**
 * Register the expand_task tool with the MCP server
 */
export function registerExpandTaskTool(server: FastMCP) {
	server.addTool({
		name: 'expand_task',
		description:
			'Expand a task into subtasks for detailed implementation. Each new subtask gets unchecked acceptance criteria that must be checked before set_task_status marks it done.',
		parameters: ExpandTaskSchema,
		annotations: { title: 'Expand Task', destructiveHint: true },
		execute: withToolContext(
			async (args: ExpandTaskArgs, context: ToolContext) => {
				const { tmCore, session } = context;
				const tag = args.tag || tmCore.config.getActiveTag();
				return replyWith(
					{ ...args, tag },
					context,
					'Error expanding task',
					async () => {
						const expanded = await tmCore.tasks.expand(
							{
								id: args.id,
								num: args.num || undefined,
								research: args.research === true,
								prompt: args.prompt,
								force: args.force === true,
								tag,
								session,
								outputType: 'mcp',
								keepExpanded: true
							},
							reportTo(context)
						);
						const { hadSubtasks } = expanded;
						// A task left as it was is the one read, with the legacy number ID
						// Subtask IDs in full ("3.1"), as get_task gives them
						const task = withFullSubtaskIds(
							expanded.skipped
								? { ...expanded.task, id: replyId(expanded.task.id) }
								: expanded.task
						);
						return {
							tag,
							note: TASK_DATA_NOTE,
							data: neutralizeTaskData(
								expanded.skipped === 'has-subtasks'
									? {
											message: `Task ${task.id} already has subtasks. Expansion skipped.`,
											task,
											subtasksAdded: 0,
											hasExistingSubtasks: hadSubtasks
										}
									: {
											task,
											// Any old subtasks were replaced, so all of them are new
											subtasksAdded: task.subtasks?.length ?? 0,
											hasExistingSubtasks: hadSubtasks,
											telemetryData: expanded.telemetryData ?? undefined,
											tagInfo: expanded.tagInfo ?? undefined
										}
							)
						};
					}
				);
			}
		)
	});
}

/**
 * Register the expand_all tool with the MCP server
 */
export function registerExpandAllTool(server: FastMCP) {
	server.addTool({
		name: 'expand_all',
		description:
			'Expand all pending tasks into subtasks based on complexity or defaults. Each new subtask gets unchecked acceptance criteria that must be checked before set_task_status marks it done.',
		parameters: ExpandAllSchema,
		annotations: { title: 'Expand All Tasks', destructiveHint: true },
		execute: withToolContext(
			async (
				args: ExpandAllArgs & { projectRoot: string },
				context: ToolContext
			) => {
				const { tmCore, session, log } = context;
				const tag = args.tag || tmCore.config.getActiveTag();
				const options: ExpandOptions = {
					num: args.num || undefined,
					research: args.research === true,
					prompt: args.prompt,
					force: args.force === true,
					tag,
					session,
					outputType: 'mcp'
				};
				return replyWith(
					{ ...args, tag },
					context,
					'Error expanding all tasks',
					async () => {
						const summary = await tmCore.tasks.expandAll(options, {
							...reportTo(context),
							onStart: (ids) =>
								log.info(`Found ${ids.length} tasks eligible for expansion.`),
							onTaskDone: (id, outcome) => {
								if (outcome instanceof Error) {
									log.error(`Couldn't expand task ${id}: ${outcome.message}`);
								} else if (outcome.skipped) {
									log.info(
										`Skipped task ${id}: complexity report recommends no expansion.`
									);
								} else {
									log.info(`Expanded task ${id}.`);
								}
							}
						});
						const { expandedCount, failedCount, skippedCount, tasksToExpand } =
							summary;
						return {
							tag,
							data: {
								message: `Expand all operation completed. Expanded: ${expandedCount}, Failed: ${failedCount}, Skipped: ${skippedCount}`,
								details: {
									expandedCount,
									failedCount,
									skippedCount,
									tasksToExpand
								},
								// The legacy reply had [] here when no task was eligible
								telemetryData: tasksToExpand === 0 ? [] : summary.telemetryData
							}
						};
					}
				);
			}
		)
	});
}
