/**
 * models.js
 * MCP tool for managing AI model configurations
 */

import { createErrorResponse, handleApiResult, withToolContext } from '@tm/mcp';
import { z } from 'zod';
import { modelsDirect } from '../core/task-master-core.js';

/**
 * Register the models tool with the MCP server
 * @param {Object} server - FastMCP server instance
 */
export function registerModelsTool(server) {
	server.addTool({
		name: 'models',
		description:
			'Get information about available AI models or set model configurations. TaskGraph uses Claude Code (models: opus, sonnet, haiku). Run without arguments to get the current model configuration.',
		parameters: z.object({
			setMain: z
				.string()
				.optional()
				.describe(
					'Set the primary model for task generation/updates. One of: opus, sonnet, haiku.'
				),
			setResearch: z
				.string()
				.optional()
				.describe(
					'Set the model for research-backed operations. One of: opus, sonnet, haiku.'
				),
			setFallback: z
				.string()
				.optional()
				.describe(
					'Set the model to use if the primary fails. One of: opus, sonnet, haiku.'
				),
			listAvailableModels: z
				.boolean()
				.optional()
				.describe('List all available models.'),
			projectRoot: z
				.string()
				.describe('The directory of the project. Must be an absolute path.')
		}),
		annotations: {
			title: 'Models',
			destructiveHint: true
		},
		execute: withToolContext('models', async (args, context) => {
			try {
				context.log.info(
					`Starting models tool with args: ${JSON.stringify(args)}`
				);

				// Use args.projectRoot directly (normalized by withToolContext)
				const result = await modelsDirect(
					{ ...args, projectRoot: args.projectRoot },
					context.log,
					{ session: context.session }
				);

				return handleApiResult({
					result,
					log: context.log,
					errorPrefix: 'Error managing models',
					projectRoot: args.projectRoot
				});
			} catch (error) {
				context.log.error(`Error in models tool: ${error.message}`);
				return createErrorResponse(error.message);
			}
		})
	});
}
