/**
 * @fileoverview research MCP tool: ask the research model a question with
 * project context through tm-core's tasks.research(), optionally saving the
 * answer to a task or to .taskgraph/docs/research/
 */

import { neutralizeTaskData, TASK_DATA_NOTE } from '@tm/core';
import type { FastMCP } from 'fastmcp';
import { z } from 'zod';
import type { ToolContext } from '../../shared/types.js';
import {
	errorMessage,
	handleApiResult,
	withToolContext
} from '../../shared/utils.js';

// The schema clients see, kept as the legacy tool had it
const ResearchSchema = z.object({
	query: z.string().describe('Research query/prompt (required)'),
	taskIds: z
		.string()
		.optional()
		.describe(
			'Comma-separated list of task/subtask IDs for context (e.g., "15,16.2,17")'
		),
	filePaths: z
		.string()
		.optional()
		.describe(
			'Comma-separated list of file paths for context (e.g., "src/api.js,docs/readme.md")'
		),
	customContext: z
		.string()
		.optional()
		.describe('Additional custom context text to include in the research'),
	includeProjectTree: z
		.boolean()
		.optional()
		.describe(
			'Include project file tree structure in context (default: false)'
		),
	detailLevel: z
		.enum(['low', 'medium', 'high'])
		.optional()
		.describe('Detail level for the research response (default: medium)'),
	saveTo: z
		.string()
		.optional()
		.describe(
			'Automatically save research results to specified task/subtask ID (e.g., "15" or "15.2")'
		),
	saveToFile: z
		.boolean()
		.optional()
		.describe(
			'Save research results to .taskgraph/docs/research/ directory (default: false)'
		),
	projectRoot: z
		.string()
		.describe('The directory of the project. Must be an absolute path.'),
	tag: z.string().optional().describe('Tag context to operate on')
});

type ResearchArgs = z.infer<typeof ResearchSchema>;

const list = (value?: string) =>
	value
		?.split(',')
		.map((item) => item.trim())
		.filter(Boolean) ?? [];

/**
 * Register the research tool with the MCP server
 */
export function registerResearchTool(server: FastMCP) {
	server.addTool({
		name: 'research',
		description: 'Perform AI-powered research queries with project context',
		parameters: ResearchSchema,
		annotations: {
			title: 'Research',
			destructiveHint: true,
			openWorldHint: true
		},
		execute: withToolContext(
			async (args: ResearchArgs, { log, session, tmCore }: ToolContext) => {
				const { projectRoot } = args;
				const tag = args.tag || tmCore.config.getActiveTag();
				const reply = (
					result: Parameters<typeof handleApiResult>[0]['result']
				) =>
					handleApiResult({
						result,
						log,
						errorPrefix: 'Error performing research',
						projectRoot,
						tag,
						note: TASK_DATA_NOTE
					});
				try {
					const result = await tmCore.tasks.research(
						{
							query: args.query,
							taskIds: list(args.taskIds),
							filePaths: list(args.filePaths),
							customContext: args.customContext,
							includeProjectTree: args.includeProjectTree,
							detailLevel: args.detailLevel,
							saveTo: args.saveTo,
							saveToFile: args.saveToFile,
							tag,
							session,
							outputType: 'mcp'
						},
						{
							onWarning: (message) => log.warn(message),
							onDebug: (message) => log.debug(message)
						}
					);
					// The answer is kept: a save that failed after the AI call is
					// reported in saveFailures, not as an error a retry would repeat
					for (const failure of result.saveFailures) {
						log.warn(
							`Error saving research to ${failure.kind === 'task' ? 'task/subtask' : 'file'}: ${failure.message}`
						);
					}
					if (result.savedTo) {
						log.info(
							`Research saved to ${result.savedTo.id.includes('.') ? 'subtask' : 'task'} ${result.savedTo.id}`
						);
					}
					return reply({
						success: true,
						data: neutralizeTaskData({
							query: result.query,
							result: result.result,
							contextSize: result.contextSize,
							contextTokens: result.contextTokens,
							tokenBreakdown: result.tokenBreakdown,
							systemPromptTokens: result.systemPromptTokens,
							userPromptTokens: result.userPromptTokens,
							totalInputTokens: result.totalInputTokens,
							detailLevel: result.detailLevel,
							telemetryData: result.telemetryData,
							tagInfo: result.tagInfo,
							savedFilePath: result.savedFilePath,
							savedTo: result.savedTo,
							...(result.saveFailures.length
								? { saveFailures: result.saveFailures }
								: {})
						})
					});
				} catch (error: unknown) {
					const message = errorMessage(error);
					log.error(`research failed: ${message}`);
					return reply({ success: false, error: { message } });
				}
			}
		)
	});
}
