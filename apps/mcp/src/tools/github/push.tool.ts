/**
 * @fileoverview github_push MCP tool
 * Create or update GitHub issues for tasks (one way, previewed by default)
 */

import type { FastMCP } from 'fastmcp';
import { z } from 'zod';
import type { ToolContext } from '../../shared/types.js';
import { handleApiResult, withToolContext } from '../../shared/utils.js';

const PushSchema = z.object({
	projectRoot: z
		.string()
		.describe('Absolute path to the project root directory'),
	dryRun: z
		.boolean()
		.optional()
		.default(true)
		.describe(
			'Preview the plan without writing to GitHub (default: true). Pass false to create and update issues.'
		),
	tag: z.string().optional().describe('Tag to push (default: the active tag)'),
	allTags: z.boolean().optional().describe('Push every tag instead of one'),
	id: z
		.string()
		.optional()
		.describe('Only push these top-level task IDs, comma separated'),
	repo: z
		.string()
		.optional()
		.describe('Repository as owner/name (default: detected through gh)'),
	includeDetails: z
		.boolean()
		.optional()
		.describe('Include the task details field in issue bodies'),
	closeOrphans: z
		.boolean()
		.optional()
		.describe('Close open issues whose task no longer exists')
});

type PushArgs = z.infer<typeof PushSchema>;

/**
 * Register the github_push tool with the MCP server
 */
export function registerGithubPushTool(server: FastMCP) {
	server.addTool({
		name: 'github_push',
		description:
			'Push tasks to GitHub Issues through the gh CLI: creates issues, updates changed ones and closes finished ones. Runs as a dry run unless dryRun is false, so call it once to review the plan before writing.',
		parameters: PushSchema,
		annotations: {
			title: 'Push Tasks to GitHub',
			readOnlyHint: false,
			destructiveHint: false,
			openWorldHint: true
		},
		execute: withToolContext(
			async (args: PushArgs, { log, tmCore }: ToolContext) => {
				// Default to a preview here as well as in the schema, so a caller that
				// skips schema parsing can never write by accident
				const { projectRoot, id, dryRun = true, ...rest } = args;

				try {
					log.info(
						`Pushing tasks to GitHub for ${projectRoot} (dryRun: ${dryRun})`
					);
					const result = await tmCore.github.push({
						...rest,
						dryRun,
						taskIds: id
					});
					return handleApiResult({
						result: { success: true, data: result },
						log,
						projectRoot
					});
				} catch (error: any) {
					log.error(`Error in github_push: ${error.message}`);
					return handleApiResult({
						result: {
							success: false,
							error: {
								message: `Failed to push to GitHub: ${error.message}`
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
