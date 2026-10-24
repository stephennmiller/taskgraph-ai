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
import { isAbort } from '../../ai/ai-errors.js';
import type { AiConfig, AiRole } from '../../ai/config-ai-host.js';
import { aiCallTimeoutMs } from '../../ai/providers/base-provider.js';
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
			// The stream stalled: one request would wait out a fresh limit (#587)
			if (isAbort(error)) {
				hooks.onStreamFailed?.(failure, false);
				throw error;
			}
			// AiService and the provider wrap a start error, so look through
			// `cause`; the depth limit also stops a cycle (#588)
			let refused = false;
			for (
				let e: any = error, depth = 0;
				e && depth < 10 && !refused;
				e = e.cause, depth++
			) {
				refused = APICallError.isInstance(e);
			}
			const retrying = !(refused && !hasOtherModel(context));
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
	// A long PRD streams for minutes, so the limit is on the gap between parts
	const idleMs = aiCallTimeoutMs();
	const idle = new AbortController();
	const stalled = new Promise<never>((_, reject) =>
		idle.signal.addEventListener('abort', () => reject(idle.signal.reason))
	);
	stalled.catch(() => {});
	let timer: ReturnType<typeof setTimeout> | undefined;
	const resetIdle = () => {
		clearTimeout(timer);
		timer = setTimeout(
			() =>
				idle.abort(
					new DOMException(
						`The AI stopped sending tasks: nothing arrived for ${Math.round(idleMs / 1000)} seconds. Try again, or set TASKGRAPH_AI_TIMEOUT_MS (milliseconds) to wait longer.`,
						'TimeoutError'
					)
				),
			idleMs
		);
	};
	resetIdle();
	try {
		const response = await Promise.race([
			context.ai.streamObject({ ...context.params, abortSignal: idle.signal }),
			stalled
		]);
		const stream = response?.mainResult;
		// Read the getter once: each read pipes the underlying stream, so a second
		// read fails with "ReadableStream is locked"
		const partials = stream?.partialObjectStream;
		if (!partials) {
			throw new Error('AI service did not return a stream');
		}

		// Race each part against the timer: a provider may ignore the signal
		const iterator = partials[Symbol.asyncIterator]();
		for (;;) {
			const next = await Promise.race([iterator.next(), stalled]);
			if (next.done) break;
			resetIdle();
			context.hooks.onPartial?.(next.value);
		}
		// The SDK may end the stream quietly on abort rather than throw
		if (idle.signal.aborted) throw idle.signal.reason;

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
	} finally {
		clearTimeout(timer);
	}
}

/**
 * Usage for a stream is only known once it ends, so the service leaves its
 * telemetry null; build it here from the real token counts
 */
async function streamTelemetry(
	stream: any,
	response: AiServiceResult,
	context: GenerateContext
): Promise<AiServiceResult['telemetryData']> {
	const previous = response.telemetryData;
	try {
		const usage = await stream.usage;
		return (
			(await context.ai.logUsage({
				userId: context.aiConfig.userId,
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
			`Couldn't read the stream's token usage (${(error as Error)?.message}); leaving the usage unreported`
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
