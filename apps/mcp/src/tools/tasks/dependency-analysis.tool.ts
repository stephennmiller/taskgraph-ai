/**
 * @fileoverview dependency_analysis MCP tool
 * Bottlenecks, critical path and cycles for a tag, plus why one task is blocked
 */

import { taskIdSchema } from '@tm/core';
import type { FastMCP } from 'fastmcp';
import { z } from 'zod';
import type { ToolContext } from '../../shared/types.js';
import { handleApiResult, withToolContext } from '../../shared/utils.js';

const DependencyAnalysisSchema = z.object({
	id: taskIdSchema
		.optional()
		.describe('Task or subtask ID (e.g. 5 or 5.2) to explain what blocks it'),
	limit: z
		.number()
		.int()
		.positive()
		.optional()
		.describe('How many bottlenecks to return (default 5)'),
	projectRoot: z
		.string()
		.describe('Absolute path to the project root directory'),
	tag: z.string().optional().describe('Tag context to operate on')
});

type DependencyAnalysisArgs = z.infer<typeof DependencyAnalysisSchema>;

/**
 * Register the dependency_analysis tool with the MCP server
 */
export function registerDependencyAnalysisTool(server: FastMCP) {
	server.addTool({
		name: 'dependency_analysis',
		description:
			'Find the bottlenecks (open tasks holding up the most work), the critical path and dependency cycles. With id, also explain what blocks that task.',
		parameters: DependencyAnalysisSchema,
		annotations: {
			title: 'Dependency Analysis',
			readOnlyHint: true
		},
		execute: withToolContext(
			async (args: DependencyAnalysisArgs, { log, tmCore }: ToolContext) => {
				const { id, limit, projectRoot, tag } = args;

				try {
					log.info(
						`Analyzing dependencies${id ? ` for task ${id}` : ''} in ${projectRoot}`
					);
					const data = await tmCore.tasks.analyzeDependencies({
						tag,
						limit,
						taskId: id
					});
					return handleApiResult({
						result: { success: true, data },
						log,
						projectRoot,
						tag
					});
				} catch (error: any) {
					log.error(`Error in dependency_analysis: ${error.message}`);
					return handleApiResult({
						result: {
							success: false,
							error: {
								message: `Failed to analyze dependencies: ${error.message}`
							}
						},
						log,
						projectRoot
					});
				}
			}
		)
	});
}
