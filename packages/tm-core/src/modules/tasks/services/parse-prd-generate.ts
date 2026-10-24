/**
 * @fileoverview The AI call that writes parse-prd's tasks. Streamed when the
 * caller shows progress, so each task can appear as soon as the model
 * finishes it; anything that goes wrong with the stream falls back to one
 * generateObject call, which is also what MCP uses.
 */

import type {
	AiService,
	AiServiceParams,
	AiServiceResult
} from '../../ai/ai-service.js';
import type { AiConfig, AiRole } from '../../ai/config-ai-host.js';
import { ParsePrdResponseSchema } from '../../ai/schemas/parse-prd.js';
import { type GeneratedPrdTask, recoverTaskList } from '../utils/prd-tasks.js';

/** Calls made around the AI call, so a caller can show progress */
export interface ParsePrdGenerateHooks {
	/**
	 * The AI call is starting. `streaming`: the task list arrives in parts
	 * (onPartial); otherwise it comes back whole
	 */
	onAiCall?: (context: {
		numTasks: number;
		startId: number;
		streaming: boolean;
	}) => void;
	/** The streamed task list so far; its last task may still be growing */
	onPartial?: (partial: {
		tasks?: Array<{ title?: string } | undefined>;
	}) => void;
	/** The model's tasks arrived (before they are saved) */
	onGenerated?: (tasks: GeneratedPrdTask[], streamed: boolean) => void;
	/** The stream failed; `retrying`: one request is tried next */
	onStreamFailed?: (error: Error, retrying: boolean) => void;
}

export interface GenerateContext {
	ai: AiService;
	aiConfig: AiConfig;
	params: AiServiceParams;
	numTasks: number;
	startId: number;
	streaming: boolean;
	hooks: ParsePrdGenerateHooks;
	debug: (message: string) => void;
}

export interface GeneratedPrdTasks {
	tasks: GeneratedPrdTask[];
	response: AiServiceResult;
}

/** The task list, streamed when `streaming`, else in one request */
export async function generatePrdTasks(
	context: GenerateContext
): Promise<GeneratedPrdTasks> {
	const { hooks, numTasks, startId } = context;
	if (context.streaming) {
		hooks.onAiCall?.({ numTasks, startId, streaming: true });
		try {
			return await streamTasks(context);
		} catch (error) {
			// The provider refused (bad model, sign-in, limits). The one-shot path
			// would retry the same model and fail again, slower; it only helps
			// when another role is set to a different model. `ai` loads here, not
			// at the top, so it loads only for AI commands (#248)
			const { APICallError } = await import('ai');
			const failure = error instanceof Error ? error : new Error(String(error));
			const retrying = !(
				APICallError.isInstance(error) && !hasOtherModel(context)
			);
			hooks.onStreamFailed?.(failure, retrying);
			context.debug(
				retrying
					? `Streaming task generation failed (${failure.message}); retrying in one request`
					: `Streaming task generation failed (${failure.message}); every role uses the same model, so not retrying`
			);
			if (!retrying) throw error;
		}
	}
	hooks.onAiCall?.({ numTasks, startId, streaming: false });
	const response = await context.ai.generateObject(context.params);
	const generated = extractTaskList(response?.mainResult);
	if (!generated) {
		throw new Error(
			'AI service returned unexpected data structure after validation.'
		);
	}
	hooks.onGenerated?.(generated.tasks, false);
	return { tasks: generated.tasks, response };
}

async function streamTasks(
	context: GenerateContext
): Promise<GeneratedPrdTasks> {
	const response = await context.ai.streamObject(context.params);
	const stream = response?.mainResult;
	// Read the getter once: each read pipes the underlying stream, so a second
	// read fails with "ReadableStream is locked"
	const partials = stream?.partialObjectStream;
	if (!partials) {
		throw new Error('AI service did not return a stream');
	}

	for await (const partial of partials) {
		context.hooks.onPartial?.(partial);
	}

	let generated: { tasks: GeneratedPrdTask[] } | null;
	try {
		generated = await stream.object;
	} catch (error) {
		// A reply with the JSON repeated fails to parse; keep the first copy
		generated = recoverTaskList((error as { text?: unknown })?.text);
		if (!generated) throw error;
		context.debug(
			`The reply did not parse (${(error as Error)?.message}); kept its first complete task list`
		);
	}
	if (!generated || !Array.isArray(generated.tasks)) {
		throw new Error('AI service returned unexpected data structure.');
	}
	context.hooks.onGenerated?.(generated.tasks, true);

	response.telemetryData = await streamTelemetry(stream, response, context);
	return { tasks: generated.tasks, response };
}

/**
 * Usage for a stream is only known once it ends, after the service has
 * already built its telemetry, so rebuild it from the real token counts
 */
async function streamTelemetry(
	stream: any,
	response: AiServiceResult,
	context: GenerateContext
): Promise<AiServiceResult['telemetryData']> {
	const previous = response.telemetryData;
	if (!previous?.userId) return previous;
	try {
		const usage = await stream.usage;
		return (
			(await context.ai.logUsage({
				userId: previous.userId,
				commandName: 'parse-prd',
				providerName: response.providerName,
				modelId: response.modelId,
				inputTokens: usage?.inputTokens ?? usage?.promptTokens ?? 0,
				outputTokens: usage?.outputTokens ?? usage?.completionTokens ?? 0,
				cachedInputTokens: usage?.inputTokenDetails?.cacheReadTokens ?? 0,
				outputType: context.params.outputType
			})) || previous
		);
	} catch (error) {
		context.debug(
			`Couldn't read the stream's token usage (${(error as Error)?.message}); keeping the usage the service reported`
		);
		return previous;
	}
}

/** Whether a fallback role would try a different model than the one that failed */
function hasOtherModel({ aiConfig, params }: GenerateContext): boolean {
	const model = (role: AiRole) => aiConfig.roleModel(role).modelId;
	const failed = model(params.role as AiRole);
	return (['main', 'fallback', 'research'] as const)
		.map(model)
		.filter(Boolean)
		.some((id) => id !== failed);
}

/** generateObject results arrive as either { tasks } or { object: { tasks } } */
function extractTaskList(
	mainResult: any
): { tasks: GeneratedPrdTask[] } | null {
	if (mainResult && typeof mainResult === 'object') {
		if (Array.isArray(mainResult.tasks)) return mainResult;
		if (Array.isArray(mainResult.object?.tasks)) return mainResult.object;
	}
	return null;
}

/** The AI service parameters for parse-prd's task call */
export function parsePrdServiceParams(
	prompts: { systemPrompt: string; userPrompt: string },
	options: {
		research: boolean;
		session?: unknown;
		projectRoot: string;
		outputType: string;
	}
): AiServiceParams {
	return {
		role: options.research ? 'research' : 'main',
		session: options.session,
		projectRoot: options.projectRoot,
		schema: ParsePrdResponseSchema,
		objectName: 'tasks_data',
		systemPrompt: prompts.systemPrompt,
		prompt: prompts.userPrompt,
		commandName: 'parse-prd',
		outputType: options.outputType
	};
}
