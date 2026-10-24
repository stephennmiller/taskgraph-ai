/**
 * @fileoverview next_task MCP tool: the next task to work on, through
 * tm-core's tasks.getNext(), or with claim: true, tasks.claimNext()
 */

import type { FastMCP } from 'fastmcp';
import { z } from 'zod';
import type { ToolContext } from '../../shared/types.js';
import { replyId, replyWith } from '../../shared/tool-reply.js';
import { withToolContext } from '../../shared/utils.js';

// The schema clients see; kept as the legacy tool had it, `file` included
const NextTaskSchema = z.object({
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
});

type NextTaskArgs = z.infer<typeof NextTaskSchema>;

const NO_NEXT_TASK =
	'No eligible next task found. All tasks are either completed or have unsatisfied dependencies';

const SUBTASK_ADVICE =
	'Subtasks can be updated with timestamped details as you implement them. This is useful for tracking progress, marking milestones and insights (of successful or successive falures in attempting to implement the subtask). Research can be used when updating the subtask to collect up-to-date information, and can be helpful to solve a repeating problem the agent is unable to solve. It is a good idea to get-task the parent task to collect the overall context of the task, and to get-task the subtask to collect the specific details of the subtask.';
const TASK_ADVICE =
	'Tasks can be updated to reflect a change in the direction of the task, or to reformulate the task per your prompt. Research can be used when updating the task to collect up-to-date information. It is best to update subtasks as you work on them, and to update the task for more high-level changes that may affect pending subtasks or the general direction of the task.';

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
							const claim = await tmCore.tasks.claimNext({ tag });
							log.info(
								claim
									? `Claimed ${claim.task.id} for ${claim.claimedBy}`
									: 'No task ready to claim'
							);
							return {
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
							};
						}
					);
				}

				return replyWith(
					{ ...args, tag },
					context,
					'Error finding next task',
					async () => {
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
							: { ...nextTask, id: replyId(nextTask.id) };
						const complexityScore = readScore(
							context,
							String(parentId ?? nextTask.id),
							tag,
							args
						);
						return {
							data: {
								nextTask:
									complexityScore === undefined
										? item
										: { ...item, complexityScore },
								isSubtask,
								nextSteps: `When ready to work on the ${isSubtask ? 'subtask' : 'task'}, use set-status to set the status to "in progress" ${isSubtask ? SUBTASK_ADVICE : TASK_ADVICE}`
							}
						};
					}
				);
			}
		)
	});
}

/** The task's score in the tag's (or the given) complexity report, if any */
function readScore(
	{ tmCore, log }: ToolContext,
	taskId: string,
	tag: string,
	args: NextTaskArgs
): number | undefined {
	try {
		const found = tmCore.tasks.getComplexityReport({
			tag,
			file: args.complexityReport
		});
		return found?.report.complexityAnalysis?.find(
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
