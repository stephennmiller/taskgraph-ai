/**
 * @fileoverview models and response-language MCP tools: read or change the
 * project's Claude Code models and the AI response language through
 * tm-core's config domain. Reply shapes are the legacy tools'.
 */

import type { FastMCP } from 'fastmcp';
import { z } from 'zod';
import type { ToolContext } from '../../shared/types.js';
import { handleApiResult, withToolContext } from '../../shared/utils.js';

// The schemas clients see; kept as the legacy tools had them
const ModelsSchema = z.object({
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
});

const ResponseLanguageSchema = z.object({
	projectRoot: z
		.string()
		.describe(
			'The root directory for the project. ALWAYS SET THIS TO THE PROJECT ROOT DIRECTORY. IF NOT SET, THE TOOL WILL NOT WORK.'
		),
	language: z
		.string()
		.describe(
			'The new response language to set. like "中文" "English" or "español".'
		)
});

type ModelsArgs = z.infer<typeof ModelsSchema>;
type ResponseLanguageArgs = z.infer<typeof ResponseLanguageSchema>;

/** Run a settings call and reply with its result, or the error it threw */
function reply(
	{ log }: ToolContext,
	projectRoot: string,
	errorPrefix: string,
	work: () => { success: boolean; data?: unknown; error?: { message: string } }
) {
	let result;
	try {
		result = work();
	} catch (error) {
		result = { success: false, error: { message: (error as Error).message } };
	}
	return handleApiResult({ result, log, errorPrefix, projectRoot });
}

/**
 * Register the models tool with the MCP server
 */
export function registerModelsTool(server: FastMCP) {
	server.addTool({
		name: 'models',
		description:
			'Get information about available AI models or set model configurations. TaskGraph uses Claude Code (models: opus, sonnet, haiku). Run without arguments to get the current model configuration.',
		parameters: ModelsSchema,
		annotations: { title: 'Models', destructiveHint: true },
		execute: withToolContext(async (args: ModelsArgs, context: ToolContext) =>
			reply(context, args.projectRoot, 'Error managing models', () => {
				const { config } = context.tmCore;
				if (args.listAvailableModels === true) {
					return config.getAvailableModelsList();
				}
				// The first role given is set; the legacy tool set one per call
				const [role, modelId] =
					(
						[
							['main', args.setMain],
							['research', args.setResearch],
							['fallback', args.setFallback]
						] as const
					).find(([, id]) => id) ?? [];
				return role
					? config.setModel(role, modelId)
					: config.getModelConfiguration();
			})
		)
	});
}

/**
 * Register the response-language tool with the MCP server
 */
export function registerResponseLanguageTool(server: FastMCP) {
	server.addTool({
		name: 'response-language',
		description: 'Get or set the response language for the project',
		parameters: ResponseLanguageSchema,
		annotations: { title: 'Response Language', destructiveHint: true },
		execute: withToolContext(
			async (args: ResponseLanguageArgs, context: ToolContext) =>
				reply(
					context,
					args.projectRoot,
					'Error setting response language',
					() => context.tmCore.config.setResponseLanguage(args.language)
				)
		)
	});
}
