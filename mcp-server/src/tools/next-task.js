/**
 * tools/next-task.js
 * Tool to find the next task to work on based on dependencies and status
 */

import {
	createErrorResponse,
	handleApiResult,
	withNormalizedProjectRoot
} from '@tm/mcp';
import { createTmCore } from '@tm/core';
import { z } from 'zod';
import { resolveTag } from '../../../scripts/modules/utils.js';
import { nextTaskDirect } from '../core/taskgraph-core.js';
import {
	resolveComplexityReportPath,
	resolveTasksPath
} from '../core/utils/path-utils.js';

/**
 * Register the nextTask tool with the MCP server
 * @param {Object} server - FastMCP server instance
 */
export function registerNextTaskTool(server) {
	server.addTool({
		name: 'next_task',
		description:
			'Find the next task to work on based on dependencies and status',
		parameters: z.object({
			file: z.string().optional().describe('Absolute path to the tasks file'),
			complexityReport: z
				.string()
				.optional()
				.describe(
					'Path to the complexity report file (relative to project root or absolute)'
				),
			projectRoot: z
				.string()
				.describe('The directory of the project. Must be an absolute path.'),
			tag: z.string().optional().describe('Tag context to operate on'),
			claim: z
				.boolean()
				.optional()
				.describe(
					'Also start the task: set it in-progress and record who claimed it, in one locked write, so parallel sessions never get the same task. Setting it back to pending releases it.'
				)
		}),
		annotations: {
			title: 'Next Task',
			// With claim: true it writes tasks.json
			readOnlyHint: false,
			destructiveHint: false
		},
		execute: withNormalizedProjectRoot(async (args, { log, session }) => {
			try {
				log.info(`Finding next task with args: ${JSON.stringify(args)}`);
				const resolvedTag = resolveTag({
					projectRoot: args.projectRoot,
					tag: args.tag
				});

				if (args.claim) {
					const tmCore = await createTmCore({ projectPath: args.projectRoot });
					const claim = await tmCore.tasks.claimNext({ tag: resolvedTag });
					log.info(
						claim
							? `Claimed ${claim.task.id} for ${claim.claimedBy}`
							: 'No task ready to claim'
					);
					return handleApiResult({
						result: {
							success: true,
							data: claim
								? {
										nextTask: claim.task,
										isSubtask: String(claim.task.id).includes('.'),
										claimedBy: claim.claimedBy,
										claimedAt: claim.claimedAt,
										nextSteps: `Task ${claim.task.id} is now in-progress and claimed by ${claim.claimedBy}. Use get_task for its details, and set_task_status to "done" when finished or to "pending" to release it.`
									}
								: {
										message:
											'No task is ready to claim. Every task is done, in progress or waiting on dependencies.',
										nextTask: null
									}
						},
						log,
						errorPrefix: 'Error claiming next task',
						projectRoot: args.projectRoot,
						tag: resolvedTag
					});
				}

				// Resolve the path to tasks.json using new path utilities
				let tasksJsonPath;
				try {
					tasksJsonPath = resolveTasksPath(args, session);
				} catch (error) {
					log.error(`Error finding tasks.json: ${error.message}`);
					return createErrorResponse(
						`Failed to find tasks.json: ${error.message}`
					);
				}

				// Resolve the path to complexity report (optional)
				let complexityReportPath;
				try {
					complexityReportPath = resolveComplexityReportPath(
						{ ...args, tag: resolvedTag },
						session
					);
				} catch (error) {
					log.error(`Error finding complexity report: ${error.message}`);
					// This is optional, so we don't fail the operation
					complexityReportPath = null;
				}

				const result = await nextTaskDirect(
					{
						tasksJsonPath: tasksJsonPath,
						reportPath: complexityReportPath,
						projectRoot: args.projectRoot,
						tag: resolvedTag
					},
					log,
					{ session }
				);

				log.info(`Next task result: ${result.success ? 'found' : 'none'}`);
				return handleApiResult({
					result,
					log: log,
					errorPrefix: 'Error finding next task',
					projectRoot: args.projectRoot,
					tag: resolvedTag
				});
			} catch (error) {
				log.error(`Error finding next task: ${error.message}`);
				return createErrorResponse(error.message);
			}
		})
	});
}
