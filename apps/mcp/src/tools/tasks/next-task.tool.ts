/**
 * @fileoverview next_task MCP tool: the next task to work on, through
 * tm-core's tasks.getNext(), or with claim: true, tasks.claimNext()
 */

import {
	neutralizeTaskData,
	TASK_DATA_NOTE,
	withFullSubtaskIds
} from '@tm/core';
import type { FastMCP } from 'fastmcp';
import { z } from 'zod';
import type { ToolContext } from '../../shared/types.js';
import { replyId, replyWith } from '../../shared/tool-reply.js';
import { withToolContext } from '../../shared/utils.js';

const NextTaskSchema = z.object({
	projectRoot: z
		.string()
		.describe('The directory of the project. Must be an absolute path.'),
	tag: z.string().optional().describe('Tag context to operate on'),
	claim: z
		.boolean()
		.optional()
		.describe(
			'Also start the task: set it in-progress and record who claimed it, in one locked write, so parallel sessions never get the same task. A task nobody is assigned to is assigned to the GitHub login gh is signed in as. Setting it back to pending releases it.'
		)
});

type NextTaskArgs = z.infer<typeof NextTaskSchema>;

const NO_NEXT_TASK =
	'No eligible next task found. All tasks are either completed or have unsatisfied dependencies';

/**
 * Register the next_task tool with the MCP server
 */
export function registerNextTaskTool(server: FastMCP) {
	server.addTool({
		name: 'next_task',
		description:
			'Find the next task to work on based on dependencies and status',
		parameters: NextTaskSchema,
		annotations: {
			title: 'Next Task',
			// With claim: true it writes tasks.json
			readOnlyHint: false,
			destructiveHint: false
		},
		execute: withToolContext(
			async (args: NextTaskArgs, context: ToolContext) => {
				const { tmCore, log } = context;
				const tag = args.tag || tmCore.config.getActiveTag();

				if (args.claim) {
					return replyWith(
						{ ...args, tag },
						context,
						'Error claiming next task',
						async () => {
							const claim = await tmCore.tasks.claimNext({
								tag,
								assignee: (await tmCore.github.currentLogin()) ?? undefined
							});
							log.info(
								claim
									? `Claimed ${claim.task.id} for ${claim.claimedBy}`
									: 'No task ready to claim'
							);
							return {
								data: claim
									? {
											nextTask: neutralizeTaskData(
												withFullSubtaskIds(claim.task)
											),
											isSubtask: String(claim.task.id).includes('.'),
											claimedBy: claim.claimedBy,
											claimedAt: claim.claimedAt,
											nextSteps: `Task ${claim.task.id} is now in-progress and claimed by ${claim.claimedBy}. Use get_task for its details, and set_task_status to "done" when finished or to "pending" to release it.`
										}
									: {
											message:
												'No task is ready to claim. Every task is done, in progress or waiting on dependencies.',
											nextTask: null
										},
								note: claim ? TASK_DATA_NOTE : undefined
							};
						}
					);
				}

				return replyWith(
					{ ...args, tag },
					context,
					'Error finding next task',
					async () => {
						// getNext reads a missing tasks.json as no tasks; legacy refused it
						tmCore.tasks.requireTasksFile();
						const nextTask = await tmCore.tasks.getNext(tag);
						if (!nextTask) {
							log.info(NO_NEXT_TASK);
							return { data: { message: NO_NEXT_TASK, nextTask: null } };
						}
						const isSubtask = String(nextTask.id).includes('.');
						log.info(
							`Found next task ${nextTask.id}: ${nextTask.title}. Is subtask: ${isSubtask}`
						);
						const { parentId } = nextTask as { parentId?: string };
						// A subtask in the legacy reply's fields, with its task's score
						const item = isSubtask
							? {
									id: nextTask.id,
									title: nextTask.title,
									status: nextTask.status,
									priority: nextTask.priority,
									dependencies: nextTask.dependencies,
									parentId: Number(parentId)
								}
							: { ...withFullSubtaskIds(nextTask), id: replyId(nextTask.id) };
						const complexityScore = readScore(
							context,
							String(parentId ?? nextTask.id),
							tag
						);
						return {
							data: {
								nextTask: neutralizeTaskData(
									complexityScore === undefined
										? item
										: { ...item, complexityScore }
								),
								isSubtask,
								nextSteps: `Start it with set_task_status id "${nextTask.id}" status "in-progress"`
							},
							note: TASK_DATA_NOTE
						};
					}
				);
			}
		)
	});
}

/** The task's score in the tag's complexity report, if any */
function readScore(
	{ tmCore, log }: ToolContext,
	taskId: string,
	tag: string
): number | undefined {
	try {
		return tmCore.tasks
			.getComplexityReport({ tag })
			?.report.complexityAnalysis?.find(
				(entry) => String(entry.taskId) === taskId
			)?.complexityScore;
	} catch (error) {
		// The report is optional; an unreadable one doesn't stop next_task
		log.warn(
			`Couldn't read the complexity report: ${(error as Error).message}`
		);
		return undefined;
	}
}
