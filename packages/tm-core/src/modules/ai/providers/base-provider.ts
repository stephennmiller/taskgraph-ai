/**
 * @fileoverview Base class for AI providers. The `ai` SDK and jsonrepair load
 * on the first call, not on import: @tm/core is imported by every command.
 */

import type { LanguageModel, ModelMessage } from 'ai';

export type ProviderLogLevel = 'debug' | 'info' | 'warn' | 'error';
/** The host's logger; the legacy CLI passes its `log`, which honours silent mode */
export type ProviderLog = (
	level: ProviderLogLevel,
	message: string,
	...args: unknown[]
) => void;

type AiModule = typeof import('ai');
type JsonSchemaNode = Record<string, any>;

export interface ProviderMessage {
	role: string;
	content: any;
}

export interface ProviderCallParams {
	apiKey?: string;
	modelId: string;
	messages: ProviderMessage[];
	maxTokens?: number | string;
	temperature?: number;
	schema?: unknown;
	objectName?: string;
	experimental_transform?: unknown;
	commandName?: string;
	role?: string;
	projectRoot?: string;
	[key: string]: unknown;
}

/** Usage as the SDK reports it, in its current and older spellings */
interface ReportedUsage {
	inputTokens?: number;
	outputTokens?: number;
	totalTokens?: number;
	promptTokens?: number;
	completionTokens?: number;
	cachedInputTokens?: number;
	inputTokenDetails?: { cacheReadTokens?: number };
}

export type ModelFactory = (modelId: string) => LanguageModel;

const INTEGER_CONSTRAINT_KEYS = new Set([
	'minimum',
	'maximum',
	'exclusiveMinimum',
	'exclusiveMaximum'
]);

const SCHEMA_OBJECT_KEYS = [
	'additionalProperties',
	'contains',
	'if',
	'then',
	'else',
	'not',
	'propertyNames'
];

const SCHEMA_ARRAY_KEYS = ['allOf', 'anyOf', 'oneOf', 'prefixItems'];

const SCHEMA_RECORD_KEYS = [
	'definitions',
	'$defs',
	'dependentSchemas',
	'patternProperties',
	'properties'
];

const isIntegerType = (type: unknown): boolean => {
	if (!type) {
		return false;
	}
	if (Array.isArray(type)) {
		return type.includes('integer');
	}
	return type === 'integer';
};

const sanitizeIntegerConstraints = (schema: any): any => {
	if (!schema || typeof schema !== 'object') {
		return schema;
	}

	if (Array.isArray(schema)) {
		return schema.map(sanitizeIntegerConstraints);
	}

	const next: JsonSchemaNode = { ...schema };

	if (isIntegerType(next.type)) {
		for (const key of INTEGER_CONSTRAINT_KEYS) {
			if (key in next) {
				delete next[key];
			}
		}
	}

	for (const key of SCHEMA_OBJECT_KEYS) {
		if (next[key]) {
			next[key] = sanitizeIntegerConstraints(next[key]);
		}
	}

	for (const key of SCHEMA_ARRAY_KEYS) {
		if (Array.isArray(next[key])) {
			next[key] = next[key].map(sanitizeIntegerConstraints);
		}
	}

	for (const key of SCHEMA_RECORD_KEYS) {
		if (next[key] && typeof next[key] === 'object') {
			const mapped: JsonSchemaNode = {};
			for (const [entryKey, entryValue] of Object.entries(next[key])) {
				mapped[entryKey] = sanitizeIntegerConstraints(entryValue);
			}
			next[key] = mapped;
		}
	}

	if (next.items) {
		next.items = sanitizeIntegerConstraints(next.items);
	}

	return next;
};

const buildSafeSchema = (ai: AiModule, schema: unknown): any => {
	const baseSchema: any = ai.zodSchema(schema as any);
	if (!baseSchema || typeof baseSchema !== 'object') {
		return baseSchema;
	}

	if (!baseSchema.jsonSchema) {
		return baseSchema;
	}

	const sanitizedSchema = sanitizeIntegerConstraints(baseSchema.jsonSchema);

	const jsonSchemaHelper = ai.jsonSchema;
	if (typeof jsonSchemaHelper === 'function') {
		return jsonSchemaHelper(sanitizedSchema, { validate: baseSchema.validate });
	}

	return { ...baseSchema, jsonSchema: sanitizedSchema };
};

// One promise for every caller, so concurrent first calls share one load
let aiModule: Promise<AiModule> | undefined;
const loadAi = () =>
	(aiModule ??= import('ai').catch((error) => {
		// Let the next call try again rather than replay the failure
		aiModule = undefined;
		throw error;
	}));

/**
 * A call that never answers would hang the command forever. Ten minutes is
 * far past a normal answer, so only a stuck call hits it. Streams get no
 * total limit, since they run for as long as the model writes; parse-prd
 * uses this as the longest wait between two parts of its stream (#587).
 */
const DEFAULT_AI_CALL_TIMEOUT_MS = 10 * 60 * 1000;

/** The AI call limit: TASKGRAPH_AI_TIMEOUT_MS, else ten minutes */
export function aiCallTimeoutMs(): number {
	const configured = Number(process.env.TASKGRAPH_AI_TIMEOUT_MS);
	return Number.isFinite(configured) && configured > 0
		? configured
		: DEFAULT_AI_CALL_TIMEOUT_MS;
}

const aiCallSignal = () => AbortSignal.timeout(aiCallTimeoutMs());

function normalizeUsage(reported: ReportedUsage | undefined) {
	const inputTokens = reported?.inputTokens ?? reported?.promptTokens ?? 0;
	const outputTokens =
		reported?.outputTokens ?? reported?.completionTokens ?? 0;
	const totalTokens = reported?.totalTokens ?? inputTokens + outputTokens;
	// Part of inputTokens read from the prompt cache
	const cachedInputTokens =
		reported?.inputTokenDetails?.cacheReadTokens ??
		reported?.cachedInputTokens ??
		0;
	return { inputTokens, outputTokens, totalTokens, cachedInputTokens };
}

/** An error handleError already wrapped, with the original's HTTP status */
class ProviderError extends Error {
	status?: number;
}

/**
 * Base class for all AI providers
 */
export abstract class BaseAIProvider {
	name: string;
	/** Whether this provider needs explicit schema in JSON mode */
	needsExplicitJsonSchema = false;
	/** Whether this provider supports temperature parameter */
	supportsTemperature = true;

	constructor(protected readonly log: ProviderLog) {
		if (new.target === (BaseAIProvider as unknown)) {
			throw new Error('BaseAIProvider cannot be instantiated directly');
		}

		// Each provider must set their name
		this.name = new.target.name;
	}

	/**
	 * Validates authentication parameters - can be overridden by providers
	 */
	validateAuth(params?: Partial<ProviderCallParams>): void {
		// Default: require API key (most providers need this)
		if (!params?.apiKey) {
			throw new Error(`${this.name} API key is required`);
		}
	}

	/**
	 * Validates common parameters across all methods
	 */
	validateParams(params: Partial<ProviderCallParams>): void {
		// Validate authentication (can be overridden by providers)
		this.validateAuth(params);

		// Validate required model ID
		if (!params.modelId) {
			throw new Error(`${this.name} Model ID is required`);
		}

		// Validate optional parameters
		this.validateOptionalParams(params);
	}

	/**
	 * Validates optional parameters like temperature and maxTokens
	 */
	validateOptionalParams(params: Partial<ProviderCallParams>): void {
		if (
			params.temperature !== undefined &&
			(params.temperature < 0 || params.temperature > 1)
		) {
			throw new Error('Temperature must be between 0 and 1');
		}
		if (params.maxTokens !== undefined) {
			const maxTokens = Number(params.maxTokens);
			if (!Number.isFinite(maxTokens) || maxTokens <= 0) {
				throw new Error('maxTokens must be a finite number greater than 0');
			}
		}
	}

	/**
	 * Validates message array structure
	 */
	validateMessages(messages: unknown): void {
		if (!messages || !Array.isArray(messages) || messages.length === 0) {
			throw new Error('Invalid or empty messages array provided');
		}

		for (const msg of messages) {
			if (!msg.role || !msg.content) {
				throw new Error(
					'Invalid message format. Each message must have role and content'
				);
			}
		}
	}

	/**
	 * Common error handler
	 */
	handleError(operation: string, error: any): never {
		// getClient errors arrive here already wrapped; don't wrap them twice
		if (error instanceof ProviderError) throw error;
		const errorMessage = error?.message || 'Unknown error occurred';
		// The caller prints the thrown error; this copy dumps the request (#272)
		this.log('debug', `${this.name} ${operation} failed: ${errorMessage}`, {
			error
		});
		const wrapped = new ProviderError(
			`${this.name} API error during ${operation}: ${errorMessage}`,
			{ cause: error }
		);
		// The service's retry check reads these (#555); the SDK calls it statusCode
		const status = error?.status ?? error?.statusCode;
		if (status !== undefined) wrapped.status = status;
		if (typeof error?.name === 'string') wrapped.name = error.name;
		throw wrapped;
	}

	/**
	 * Creates and returns a client instance for the provider
	 */
	getClient(
		_params?: Partial<ProviderCallParams>
	): ModelFactory | Promise<ModelFactory> {
		throw new Error('getClient must be implemented by provider');
	}

	/**
	 * Returns if the API key is required, defaults to true
	 */
	isRequiredApiKey(): boolean {
		return true;
	}

	/**
	 * Returns the required API key environment variable name, or null if no
	 * API key is required
	 */
	getRequiredApiKeyName(): string | null {
		throw new Error('getRequiredApiKeyName must be implemented by provider');
	}

	/**
	 * Prepares token limit parameter based on model requirements
	 */
	prepareTokenParam(
		_modelId: string,
		maxTokens: number | string | undefined
	): { maxOutputTokens?: number } {
		if (maxTokens === undefined) {
			return {};
		}

		// Ensure maxTokens is an integer
		const tokenValue = Math.floor(Number(maxTokens));

		return { maxOutputTokens: tokenValue };
	}

	/**
	 * AI SDK 7 rejects system messages inside `messages`; they must be passed as
	 * `instructions`. Splits system-role messages out of the conversation.
	 */
	prepareMessages(messages: ProviderMessage[]): {
		messages: ModelMessage[];
		instructions?: string;
	} {
		const systemMessages = messages.filter((m) => m.role === 'system');
		if (systemMessages.length === 0) {
			return { messages: messages as ModelMessage[] };
		}

		const instructions = systemMessages
			.map((m) =>
				typeof m.content === 'string'
					? m.content
					: m.content.map((part: { text?: string }) => part.text ?? '').join('')
			)
			.join('\n\n');

		return {
			instructions,
			messages: messages.filter((m) => m.role !== 'system') as ModelMessage[]
		};
	}

	private temperatureParam(params: ProviderCallParams) {
		return this.supportsTemperature && params.temperature !== undefined
			? { temperature: params.temperature }
			: {};
	}

	/**
	 * Generates text using the provider's model
	 */
	async generateText(params: ProviderCallParams) {
		try {
			const ai = await loadAi();
			this.validateParams(params);
			this.validateMessages(params.messages);

			this.log(
				'debug',
				`Generating ${this.name} text with model: ${params.modelId}`
			);

			const client = await this.getClient(params);

			const result = await ai.generateText({
				abortSignal: aiCallSignal(),
				model: client(params.modelId),
				...this.prepareMessages(params.messages),
				...this.prepareTokenParam(params.modelId, params.maxTokens),
				...this.temperatureParam(params)
			} as Parameters<AiModule['generateText']>[0]);

			this.log(
				'debug',
				`${this.name} generateText completed successfully for model: ${params.modelId}`
			);

			return {
				text: result.text,
				usage: normalizeUsage(result.usage as ReportedUsage)
			};
		} catch (error) {
			this.handleError('text generation', error);
		}
	}

	/**
	 * Streams text using the provider's model
	 */
	async streamText(params: ProviderCallParams) {
		try {
			const ai = await loadAi();
			this.validateParams(params);
			this.validateMessages(params.messages);

			this.log(
				'debug',
				`Streaming ${this.name} text with model: ${params.modelId}`
			);

			const client = await this.getClient(params);

			const stream = await ai.streamText({
				model: client(params.modelId),
				...this.prepareMessages(params.messages),
				...this.prepareTokenParam(params.modelId, params.maxTokens),
				...this.temperatureParam(params),
				...(params.experimental_transform
					? { experimental_transform: params.experimental_transform }
					: {})
			} as Parameters<AiModule['streamText']>[0]);

			this.log(
				'debug',
				`${this.name} streamText initiated successfully for model: ${params.modelId}`
			);

			return stream;
		} catch (error) {
			this.handleError('text streaming', error);
		}
	}

	/**
	 * Streams a structured object using the provider's model
	 */
	async streamObject(params: ProviderCallParams) {
		try {
			const ai = await loadAi();
			this.validateParams(params);
			this.validateMessages(params.messages);

			if (!params.schema) {
				throw new Error('Schema is required for object streaming');
			}

			this.log(
				'debug',
				`Streaming ${this.name} object with model: ${params.modelId}`
			);

			const client = await this.getClient(params);

			const schema = buildSafeSchema(ai, params.schema);

			// Same options as generateObject, so both paths ask the model the same way
			const result = await ai.streamObject({
				// The caller's, if any; a stream has no total limit (see above)
				abortSignal: params.abortSignal as AbortSignal | undefined,
				model: client(params.modelId),
				...this.prepareMessages(params.messages),
				schema,
				mode: this.needsExplicitJsonSchema ? 'json' : 'auto',
				...(params.objectName
					? {
							schemaName: params.objectName,
							schemaDescription: `Generate a valid JSON object for ${params.objectName}`
						}
					: {}),
				...this.prepareTokenParam(params.modelId, params.maxTokens),
				...this.temperatureParam(params),
				// The default prints the whole error object to the terminal; callers
				// already get the error from the stream's promises
				onError: ({ error }: { error: any }) =>
					this.log(
						'debug',
						`${this.name} stream error: ${error?.message ?? error}`
					)
			} as unknown as Parameters<AiModule['streamObject']>[0]);

			this.log(
				'debug',
				`${this.name} streamObject initiated successfully for model: ${params.modelId}`
			);

			// Return the stream result directly
			// The stream result contains partialObjectStream and other properties
			return result;
		} catch (error) {
			this.handleError('object streaming', error);
		}
	}

	/**
	 * Generates a structured object using the provider's model
	 */
	async generateObject(params: ProviderCallParams) {
		// Outside the try: the repair below needs the SDK's error classes
		const ai = await loadAi();
		try {
			this.validateParams(params);
			this.validateMessages(params.messages);

			if (!params.schema) {
				throw new Error('Schema is required for object generation');
			}
			if (!params.objectName) {
				throw new Error('Object name is required for object generation');
			}

			this.log(
				'debug',
				`Generating ${this.name} object ('${params.objectName}') with model: ${params.modelId}`
			);

			const client = await this.getClient(params);

			const schema = buildSafeSchema(ai, params.schema);

			const result = await ai.generateObject({
				abortSignal: aiCallSignal(),
				model: client(params.modelId),
				...this.prepareMessages(params.messages),
				schema,
				mode: this.needsExplicitJsonSchema ? 'json' : 'auto',
				schemaName: params.objectName,
				schemaDescription: `Generate a valid JSON object for ${params.objectName}`,
				...this.prepareTokenParam(params.modelId, params.maxTokens),
				...this.temperatureParam(params)
			} as unknown as Parameters<AiModule['generateObject']>[0]);

			this.log(
				'debug',
				`${this.name} generateObject completed successfully for model: ${params.modelId}`
			);

			return {
				object: result.object as any,
				usage: normalizeUsage(result.usage as ReportedUsage)
			};
		} catch (error: any) {
			// Check if this is a JSON parsing error that we can potentially fix
			if (
				ai.NoObjectGeneratedError.isInstance(error) &&
				error.cause instanceof ai.JSONParseError &&
				error.cause.text
			) {
				this.log(
					'warn',
					`${this.name} generated malformed JSON, attempting to repair...`
				);

				try {
					// Use jsonrepair to fix the malformed JSON
					const { jsonrepair } = await import('jsonrepair');
					const repairedJson = jsonrepair(error.cause.text);
					const parsed = JSON.parse(repairedJson);

					this.log('debug', `Successfully repaired ${this.name} JSON output`);

					const usage = error.usage as ReportedUsage | undefined;
					// Return in the expected format
					return {
						object: parsed,
						usage: {
							// Extract usage information from the error if available
							inputTokens: usage?.promptTokens || usage?.inputTokens || 0,
							outputTokens: usage?.completionTokens || usage?.outputTokens || 0,
							totalTokens: usage?.totalTokens || 0
						}
					};
				} catch (repairError: any) {
					this.log(
						'error',
						`Failed to repair ${this.name} JSON: ${repairError.message}`
					);
					// Fall through to handleError with original error
				}
			}

			this.handleError('object generation', error);
		}
	}
}
