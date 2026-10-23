/**
 * tools/parsePRD.js
 * Tool to parse PRD document and generate tasks
 */

import {
	checkProgressCapability,
	createErrorResponse,
	handleApiResult,
	withNormalizedProjectRoot
} from '@tm/mcp';
import { z } from 'zod';
import { resolveTag } from '../../../scripts/modules/utils.js';
import {
	PRD_FILE,
	TASKGRAPH_DOCS_DIR,
	TASKGRAPH_TASKS_FILE
} from '../../../src/constants/paths.js';
import { parsePRDDirect } from '../core/taskgraph-core.js';

/**
 * Register the parse_prd tool
 * @param {Object} server - FastMCP server instance
 */
export function registerParsePRDTool(server) {
	server.addTool({
		name: 'parse_prd',
		description: `Parse a Product Requirements Document (PRD) text file to automatically generate initial tasks. Reinitializing the project is not necessary to run this tool. It is recommended to run parse-prd after initializing the project and creating/importing a prd.txt file in the project root's ${TASKGRAPH_DOCS_DIR} directory. Each generated task gets unchecked acceptance criteria that must be checked before set_task_status marks it done.`,

		parameters: z.object({
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
						question: z
							.string()
							.describe('The question, as clarify returned it'),
						answer: z.string().describe("The user's answer")
					})
				)
				.optional()
				.describe(
					'Answers to save in the PRD under "## Clarifications" before generating tasks, so the tasks follow them'
				)
		}),
		annotations: {
			title: 'Parse PRD',
			destructiveHint: true
		},
		execute: withNormalizedProjectRoot(
			async (args, { log, session, reportProgress }) => {
				try {
					const resolvedTag = resolveTag({
						projectRoot: args.projectRoot,
						tag: args.tag
					});
					const progressCapability = checkProgressCapability(
						reportProgress,
						log
					);
					const result = await parsePRDDirect(
						{
							...args,
							tag: resolvedTag
						},
						log,
						{ session, reportProgress: progressCapability }
					);
					return handleApiResult({
						result,
						log: log,
						errorPrefix: 'Error parsing PRD',
						projectRoot: args.projectRoot
					});
				} catch (error) {
					log.error(`Error in parse_prd: ${error.message}`);
					return createErrorResponse(`Failed to parse PRD: ${error.message}`);
				}
			}
		)
	});
}
