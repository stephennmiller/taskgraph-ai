/**
 * @fileoverview scope_up_task and scope_down_task MCP tools: make tasks more
 * or less complex with the AI through tm-core's tasks.scope(). Reply shapes
 * are the legacy tools', plus `warnings` when there are any.
 */

import { withFullSubtaskIds } from '@tm/core';
import type { FastMCP } from 'fastmcp';
import { z } from 'zod';
import type { ToolContext } from '../../shared/types.js';
import { replyId, replyWith } from '../../shared/tool-reply.js';
import { withToolContext } from '../../shared/utils.js';

// The schema clients see; kept as the legacy tools had it, `file` included
const scopeSchema = (direction: 'up' | 'down') =>
	z.object({
		id: z
			.string()
			.describe(
				`Comma-separated list of task IDs to scope ${direction} (e.g., "1,3,5")`
			),
		strength: z
			.string()
			.optional()
			.describe('Strength level: light, regular, or heavy (default: regular)'),
		prompt: z
			.string()
			.optional()
			.describe('Custom prompt for specific scoping adjustments'),
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
			.describe('Whether to use research capabilities for scoping')
	});

type ScopeArgs = z.infer<ReturnType<typeof scopeSchema>>;

function registerScopeTool(server: FastMCP, direction: 'up' | 'down') {
	server.addTool({
		name: `scope_${direction}_task`,
		description: `${direction === 'up' ? 'Increase' : 'Decrease'} the complexity of one or more tasks using AI`,
		parameters: scopeSchema(direction),
		annotations: {
			title: `Scope ${direction === 'up' ? 'Up' : 'Down'} Task`,
			destructiveHint: true
		},
		execute: withToolContext(async (args: ScopeArgs, context: ToolContext) => {
			const { tmCore, session, log } = context;
			const tag = args.tag || tmCore.config.getActiveTag();
			return replyWith(
				{ ...args, tag },
				context,
				`Error scoping ${direction} task`,
				async () => {
					// Sent in the reply too: the client may not show the log
					const warnings: string[] = [];
					const result = await tmCore.tasks
						.scope(
							{
								ids: args.id,
								direction,
								strength: args.strength,
								prompt: args.prompt,
								research: args.research === true,
								tag,
								session,
								outputType: 'mcp'
							},
							{
								onWarning: (message) => {
									warnings.push(message);
									log.warn(message);
								},
								onDebug: (message) => log.debug(message)
							}
						)
						.catch((error: unknown) => {
							// A task saved before the failure may have warned; the error reply is all the client gets
							if (error instanceof Error && warnings.length > 0) {
								error.message += `. Warnings: ${warnings.join('; ')}`;
							}
							throw error;
						});
					for (const { task, complexity } of result.tasks) {
						if (!complexity) continue;
						const change = complexity.after - complexity.before;
						log.info(
							`Task ${task.id} complexity: ${complexity.before}/10 → ${complexity.after}/10 (${change > 0 ? '+' : ''}${change})`
						);
					}
					// The legacy reply gave task IDs as numbers
					const updatedTasks = result.tasks.map(({ task }) =>
						withFullSubtaskIds({ ...task, id: replyId(task.id) })
					);
					return {
						tag: result.tag,
						data: {
							updatedTasks,
							tasksUpdated: updatedTasks.length,
							message: `Successfully scoped ${direction} ${updatedTasks.length} task(s)`,
							telemetryData: result.telemetryData,
							...(warnings.length > 0 && { warnings })
						}
					};
				}
			);
		})
	});
}

export function registerScopeUpTool(server: FastMCP) {
	registerScopeTool(server, 'up');
}

export function registerScopeDownTool(server: FastMCP) {
	registerScopeTool(server, 'down');
}
