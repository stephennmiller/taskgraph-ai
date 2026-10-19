/**
 * @fileoverview github_status MCP tool
 * Report whether pushing to GitHub is possible and how many tasks are linked
 */

import type { FastMCP } from 'fastmcp';
import { z } from 'zod';
import type { ToolContext } from '../../shared/types.js';
import { handleApiResult, withToolContext } from '../../shared/utils.js';

const StatusSchema = z.object({
	projectRoot: z
		.string()
		.describe('Absolute path to the project root directory'),
	repo: z
		.string()
		.optional()
		.describe('Repository as owner/name (default: detected through gh)')
});

type StatusArgs = z.infer<typeof StatusSchema>;

/**
 * Register the github_status tool with the MCP server
 */
export function registerGithubStatusTool(server: FastMCP) {
	server.addTool({
		name: 'github_status',
		description:
			'Check whether the gh CLI is usable, which GitHub repository tasks would be pushed to, and how many tasks are already linked to issues.',
		parameters: StatusSchema,
		annotations: {
			title: 'GitHub Sync Status',
			readOnlyHint: true
		},
		execute: withToolContext(
			async (args: StatusArgs, { log, tmCore }: ToolContext) => {
				const { projectRoot, repo } = args;

				try {
					log.info(`Checking GitHub sync status for ${projectRoot}`);
					const status = await tmCore.github.status({ repo });
					return handleApiResult({
						result: { success: true, data: status },
						log,
						projectRoot
					});
				} catch (error: any) {
					log.error(`Error in github_status: ${error.message}`);
					return handleApiResult({
						result: {
							success: false,
							error: {
								message: `Failed to get GitHub status: ${error.message}`
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
