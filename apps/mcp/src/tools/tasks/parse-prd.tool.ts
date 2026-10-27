/**
 * @fileoverview parse_prd MCP tool: generate a tag's tasks from a PRD
 * through tm-core's tasks.parsePrd(), or with `clarify` the questions to ask
 * about gaps in the PRD first (tasks.findPrdGaps). The reply shape is the
 * legacy tool's.
 */

import {
	type PrdDelta,
	neutralizeTaskData,
	PRD_FILE,
	TASK_DATA_NOTE,
	TASKGRAPH_DOCS_DIR,
	TASKGRAPH_TASKS_FILE,
	parseClarificationAnswers,
	writeClarifications
} from '@tm/core';
import type { FastMCP } from 'fastmcp';
import { z } from 'zod';
import type { ToolContext } from '../../shared/types.js';
import { replyWith } from '../../shared/tool-reply.js';
import { withToolContext } from '../../shared/utils.js';

// The schema clients see; kept as the legacy tool had it
const ParsePrdSchema = z.object({
	input: z
		.string()
		.optional()
		.default(PRD_FILE)
		.describe('Absolute path to the PRD document file (.txt, .md, etc.)'),
	projectRoot: z
		.string()
		.describe('The directory of the project. Must be an absolute path.'),
	tag: z.string().optional().describe('Tag context to operate on'),
	output: z
		.string()
		.optional()
		.describe(
			`Output path for tasks.json file (default: ${TASKGRAPH_TASKS_FILE})`
		),
	numTasks: z
		.string()
		.optional()
		.describe(
			'Approximate number of top-level tasks to generate. Pass 0 to let TaskGraph size the list to the PRD. Omitted, it uses the project config defaultNumTasks, which is 0 unless set. Avoid numbers above 50 due to context window limitations.'
		),
	force: z
		.boolean()
		.optional()
		.default(false)
		.describe('Overwrite existing output file without prompting.'),
	research: z
		.boolean()
		.optional()
		.describe(
			'Enable TaskGraph to use the research role for potentially more informed task generation. Requires appropriate API key.'
		),
	append: z
		.boolean()
		.optional()
		.describe(
			'Append generated tasks to existing file. For a PRD parsed before, only sections added since then get tasks; changed and removed sections are listed in prdChanges, and an unchanged PRD adds nothing.'
		),
	clarify: z
		.boolean()
		.optional()
		.describe(
			'Return up to 5 questions about gaps in the PRD, each with a suggestedAnswer, without generating tasks. Ask the user, then call parse_prd again with their answers in clarifications.'
		),
	clarifications: z
		.array(
			z.object({
				question: z.string().describe('The question, as clarify returned it'),
				answer: z.string().describe("The user's answer")
			})
		)
		.optional()
		.describe(
			'Answers to save in the PRD under "## Clarifications" before generating tasks, so the tasks follow them'
		)
});

type ParsePrdArgs = z.infer<typeof ParsePrdSchema>;

/** The PRD changes an append found, as the legacy reply listed them */
function prdChanges(delta: PrdDelta) {
	return {
		prd: delta.path,
		newSections: delta.added.map((s) => s.slug),
		changedSections: delta.changed.map((c) => ({
			section: c.slug,
			mayBeStale: c.taskIds
		})),
		removedSections: delta.removed.map((r) => ({
			section: r.slug,
			tasks: r.taskIds
		}))
	};
}

/**
 * Register the parse_prd tool with the MCP server
 */
export function registerParsePrdTool(server: FastMCP) {
	server.addTool({
		name: 'parse_prd',
		description: `Parse a Product Requirements Document (PRD) text file to automatically generate initial tasks. Reinitializing the project is not necessary to run this tool. It is recommended to run parse-prd after initializing the project and creating/importing a prd.txt file in the project root's ${TASKGRAPH_DOCS_DIR} directory. Each generated task gets unchecked acceptance criteria that must be checked before set_task_status marks it done.`,
		parameters: ParsePrdSchema,
		annotations: { title: 'Parse PRD', destructiveHint: true },
		execute: withToolContext(
			async (args: ParsePrdArgs, context: ToolContext) => {
				const { tmCore, session, log, reportProgress } = context;
				// tm-core's warnings, and AI detail with global.debug on, to the client log
				const logHooks = {
					onWarning: (message: string) => log.warn(message),
					onDebug: (message: string) => log.debug(message)
				};
				const tag = args.tag || tmCore.config.getActiveTag();
				return replyWith(
					{ ...args, tag, file: args.output },
					context,
					'Error parsing PRD',
					async () => {
						// tm-core refuses a PRD outside the project, a secret file or
						// a link out of it, before the answers are written into it
						const { prdPath } = await tmCore.tasks.parsePrdTarget({
							prdPath: args.input,
							tag
						});
						if (args.clarify && args.clarifications) {
							throw new Error(
								'Pass clarify to get questions, or clarifications to save answers, not both'
							);
						}

						// clarify: the questions for the agent to ask the user; no tasks yet
						if (args.clarify) {
							const { questions, telemetryData } =
								await tmCore.tasks.findPrdGaps(
									{
										prdPath,
										research: args.research === true,
										session,
										outputType: 'mcp'
									},
									logHooks
								);
							return {
								tag,
								note: TASK_DATA_NOTE,
								data: neutralizeTaskData({
									message:
										questions.length > 0
											? `Ask the user these ${questions.length} questions, then call parse_prd with their answers in clarifications`
											: 'No open questions; call parse_prd without clarify to generate tasks',
									questions,
									telemetryData
								})
							};
						}

						// Answers go into the PRD first, so the tasks are generated from them
						const clarifications =
							args.clarifications &&
							writeClarifications(
								prdPath,
								parseClarificationAnswers(args.clarifications)
							);

						const result = await tmCore.tasks.parsePrd(
							{
								prdPath,
								numTasks: args.numTasks,
								force: args.force === true,
								append: args.append === true,
								research: args.research === true,
								tag,
								session,
								outputType: 'mcp'
							},
							logHooks
						);
						// Sent once the AI's tasks are saved; an append with nothing new made no call
						const delta = result.prdDelta?.known ? result.prdDelta : null;
						if (reportProgress && !(delta && delta.added.length === 0)) {
							// The tasks are saved; a failed notification must not report a
							// failure an agent would retry
							try {
								await reportProgress({
									progress: result.added,
									total: result.added,
									message: completionMessage(result)
								});
							} catch (error) {
								log.debug(
									`Progress report failed: ${(error as Error)?.message}`
								);
							}
						}

						// With append only new PRD sections get tasks; an unchanged PRD
						// adds none, and changed or removed sections are listed
						const message =
							delta && result.added === 0
								? `No new sections in ${delta.path}; no tasks added`
								: `Successfully parsed PRD and generated tasks in ${result.tasksPath}`;
						log.info(message);
						return {
							tag,
							data: {
								message,
								outputPath: result.tasksPath,
								addedTasks: result.added,
								...(delta ? { prdChanges: prdChanges(delta) } : {}),
								telemetryData: result.telemetryData,
								tagInfo: result.tagInfo,
								...(clarifications
									? {
											clarifications: {
												added: clarifications.added,
												updated: clarifications.updated,
												unchanged: clarifications.unchanged
											}
										}
									: {})
							}
						};
					}
				);
			}
		)
	});
}

/** The progress line the legacy tool sent when the tasks were saved */
function completionMessage(result: {
	telemetryData: {
		inputTokens?: number;
		outputTokens?: number;
		totalCost?: number;
		currency?: string;
	} | null;
	estimatedInputTokens: number;
}): string {
	const usage = result.telemetryData;
	if (
		usage &&
		((usage.inputTokens ?? 0) > 0 || (usage.outputTokens ?? 0) > 0)
	) {
		const currency = usage.currency || 'USD';
		return `Task generation complete | Tokens (I/O): ${usage.inputTokens}/${usage.outputTokens} | Cost: ${currency === 'USD' ? '$' : currency}${(usage.totalCost || 0).toFixed(4)}`;
	}
	return `Task generation complete | ~Tokens (I/O): ${result.estimatedInputTokens}/unknown | Cost: ~$0.00`;
}
