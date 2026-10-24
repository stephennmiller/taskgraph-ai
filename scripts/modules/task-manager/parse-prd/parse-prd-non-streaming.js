/**
 * AI call for PRD parsing.
 *
 * In the terminal the task list is streamed, so each task appears as soon as
 * the model finishes it. Anything that goes wrong with the stream falls back
 * to a single generateObject call, which is also what MCP uses.
 */

import path from 'path';
import chalk from 'chalk';
import {
	getFallbackModelId,
	getMainModelId,
	getResearchModelId
} from '../../config-manager.js';
import {
	generateObjectService,
	logAiUsage,
	streamObjectService
} from '../../ai-services-unified.js';
import {
	failLoadingIndicator,
	startLoadingIndicator,
	startParsePrdProgress,
	succeedLoadingIndicator
} from '../../ui.js';
import { LoggingConfig, prdResponseSchema } from './parse-prd-config.js';
import { estimateTokens, recoverTaskList } from './parse-prd-helpers.js';

/**
 * Handle the AI service call
 * @param {Object} config - Configuration object
 * @param {Object} prompts - System and user prompts
 * @param {number} numTasks - Tasks requested (0 lets the model decide)
 * @param {number} [startId=1] - ID the first new task will get
 * @returns {Promise<Object>} Generated tasks and telemetry
 */
export async function handleNonStreamingService(
	config,
	prompts,
	numTasks,
	startId = 1
) {
	const logger = new LoggingConfig(config.mcpLog, config.reportProgress);
	const estimatedInputTokens = estimateTokens(
		prompts.systemPrompt + prompts.userPrompt
	);
	// A real terminal: not MCP, and no caller collecting progress itself
	const isCli =
		config.outputFormat === 'text' && !config.isMCP && !config.reportProgress;

	logger.report(
		`Calling AI service to generate tasks from PRD${config.research ? ' with research-backed analysis' : ''}...`,
		'debug'
	);

	if (isCli) {
		let progress = null;
		try {
			progress = startParsePrdProgress({
				prdName: path.basename(config.prdPath || 'PRD'),
				numTasks,
				startId,
				research: config.research
			});
			const result = await streamTasks(config, prompts, progress);
			return { ...result, estimatedInputTokens };
		} catch (error) {
			// The provider refused (bad model, sign-in, limits). The one-shot path
			// would retry the same model and fail again, slower; it only helps
			// when another role is set to a different model. `ai` is imported
			// here, not at the top, so it loads only for AI commands (#248)
			const { APICallError } = await import('ai');
			if (APICallError.isInstance(error) && !hasOtherModel(config)) {
				progress?.fail("Couldn't generate tasks");
				throw error;
			}
			progress?.stop();
			logger.report(
				`Streaming task generation failed (${error.message}); retrying in one request`,
				'debug'
			);
			if (progress?.printedCount) {
				console.log(
					`${chalk.yellow('⚠')} Live output stopped. Asking Claude again in one request; the final tasks may differ from the ones above.`
				);
			}
		}
	}

	return {
		...(await generateTasks(config, prompts, isCli)),
		estimatedInputTokens
	};
}

/**
 * Stream the task list, reporting each task to the progress display
 * @returns {Promise<{parsedTasks: Array, aiServiceResponse: Object}>}
 */
async function streamTasks(config, prompts, progress) {
	const aiServiceResponse = await streamObjectService({
		...serviceParams(config, prompts)
	});
	const stream = aiServiceResponse?.mainResult;
	// Read the getter once: each read pipes the underlying stream, so a second
	// read fails with "ReadableStream is locked"
	const partials = stream?.partialObjectStream;
	if (!partials) {
		throw new Error('AI service did not return a stream');
	}

	for await (const partial of partials) {
		progress?.update(partial);
	}

	let generatedData;
	try {
		generatedData = await stream.object;
	} catch (error) {
		// A reply with the JSON repeated fails to parse; keep the first copy
		generatedData = recoverTaskList(error?.text);
		if (!generatedData) throw error;
	}
	if (!generatedData || !Array.isArray(generatedData.tasks)) {
		throw new Error('AI service returned unexpected data structure.');
	}
	progress?.succeed(generatedData);

	aiServiceResponse.telemetryData = await streamTelemetry(
		stream,
		aiServiceResponse,
		config
	);
	return { parsedTasks: generatedData.tasks, aiServiceResponse };
}

/**
 * Usage for a stream is only known once it ends, after the service layer has
 * already built its telemetry, so rebuild it from the real token counts
 */
async function streamTelemetry(stream, aiServiceResponse, config) {
	const previous = aiServiceResponse.telemetryData;
	if (!previous?.userId) return previous;
	try {
		const usage = await stream.usage;
		return (
			(await logAiUsage({
				userId: previous.userId,
				commandName: 'parse-prd',
				providerName: aiServiceResponse.providerName,
				modelId: aiServiceResponse.modelId,
				inputTokens: usage?.inputTokens ?? usage?.promptTokens ?? 0,
				outputTokens: usage?.outputTokens ?? usage?.completionTokens ?? 0,
				cachedInputTokens: usage?.inputTokenDetails?.cacheReadTokens ?? 0,
				outputType: config.isMCP ? 'mcp' : 'cli'
			})) || previous
		);
	} catch {
		return previous;
	}
}

/**
 * One request for the whole task list, with a plain spinner in the terminal
 * @returns {Promise<{parsedTasks: Array, aiServiceResponse: Object}>}
 */
async function generateTasks(config, prompts, isCli) {
	const spinner = isCli
		? startLoadingIndicator('Parsing PRD and generating tasks…')
		: null;

	try {
		const aiServiceResponse = await generateObjectService(
			serviceParams(config, prompts)
		);
		const generatedData = extractTaskList(aiServiceResponse?.mainResult);
		if (!generatedData) {
			throw new Error(
				'AI service returned unexpected data structure after validation.'
			);
		}
		if (spinner) {
			succeedLoadingIndicator(
				spinner,
				`${generatedData.tasks.length} tasks generated`
			);
		}
		return { parsedTasks: generatedData.tasks, aiServiceResponse };
	} catch (error) {
		if (spinner) {
			// The reason is printed once, by the command
			failLoadingIndicator(spinner, "Couldn't generate tasks");
		}
		throw error;
	}
}

/** Whether a fallback role would try a different model than the one that failed */
function hasOtherModel(config) {
	const root = config.projectRoot;
	const failed = config.research
		? getResearchModelId(root)
		: getMainModelId(root);
	return [
		getMainModelId(root),
		getFallbackModelId(root),
		getResearchModelId(root)
	]
		.filter(Boolean)
		.some((model) => model !== failed);
}

function serviceParams(config, prompts) {
	return {
		role: config.research ? 'research' : 'main',
		session: config.session,
		projectRoot: config.projectRoot,
		schema: prdResponseSchema,
		objectName: 'tasks_data',
		systemPrompt: prompts.systemPrompt,
		prompt: prompts.userPrompt,
		commandName: 'parse-prd',
		outputType: config.isMCP ? 'mcp' : 'cli'
	};
}

/** generateObject results arrive as either { tasks } or { object: { tasks } } */
function extractTaskList(mainResult) {
	if (mainResult && typeof mainResult === 'object') {
		if (Array.isArray(mainResult.tasks)) return mainResult;
		if (Array.isArray(mainResult.object?.tasks)) return mainResult.object;
	}
	return null;
}
