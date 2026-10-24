/**
 * @fileoverview The AI service: picks the provider and model for a role, falls
 * back to the other roles, retries provider-side failures, and returns the
 * result with usage telemetry and tag info. Config getters and the logger come
 * from the host (the legacy CLI wires config-manager.js and utils.js in
 * `scripts/modules/ai-services-unified.js`).
 */

import fs from 'node:fs';
import path from 'node:path';
import { TASKGRAPH_TASKS_FILE } from '../../common/constants/paths.js';
import { extractErrorMessage, isAbort, isRetryableError } from './ai-errors.js';
import type { ProviderLog } from './providers/base-provider.js';
import {
	ClaudeCodeProvider,
	type ClaudeCodeConfigSettings
} from './providers/claude-code.js';

export type AiServiceType =
	| 'generateText'
	| 'streamText'
	| 'generateObject'
	| 'streamObject';

/** A model entry from supported-models.json, as far as cost goes */
export interface AiModelCostEntry {
	id: string;
	cost_per_1m_tokens?: {
		input?: number;
		output?: number;
		currency?: string;
	} | null;
}

export interface AiServiceHost {
	log: ProviderLog;
	getDebugFlag: () => boolean;
	findProjectRoot: () => string | null | undefined;
	/** Provider and model configured for a role ('main', 'research', 'fallback') */
	getRoleModel: (
		role: string,
		projectRoot: string | null | undefined
	) => { provider?: string | null; modelId?: string | null };
	getParametersForRole: (
		role: string,
		projectRoot: string | null | undefined
	) => { maxTokens?: number; temperature?: number };
	getResponseLanguage: (projectRoot: string | null | undefined) => string;
	getUserId: (
		projectRoot: string | null | undefined
	) => string | null | undefined;
	getCurrentTag: (projectRoot: string) => string | null | undefined;
	/** Reads a variable from the MCP session, the environment or the project's .env */
	resolveEnvVariable: (
		name: string,
		session: unknown,
		projectRoot: string | null | undefined
	) => string | null | undefined;
	getClaudeCodeSettingsForCommand: (
		commandName?: string
	) => ClaudeCodeConfigSettings | null | undefined;
	getSupportedModels: (providerName: string) => string[];
	/** supported-models.json, keyed by provider */
	getModelMap: () => Record<string, AiModelCostEntry[]> | null | undefined;
}

export interface AiServiceParams {
	role: string;
	session?: unknown;
	projectRoot?: string | null;
	systemPrompt?: string;
	prompt?: string;
	schema?: unknown;
	objectName?: string;
	commandName?: string;
	outputType?: string;
	experimental_transform?: unknown;
	[key: string]: unknown;
}

export interface AiTelemetryData {
	timestamp: string;
	userId: string;
	commandName?: string;
	modelUsed: string;
	providerName: string;
	inputTokens: number;
	outputTokens: number;
	totalTokens: number;
	cachedInputTokens?: number;
	totalCost: number;
	currency: string;
	isUnknownCost: boolean;
}

export interface AiUsageParams {
	userId: string;
	commandName?: string;
	providerName: string;
	modelId: string;
	inputTokens?: number;
	outputTokens?: number;
	cachedInputTokens?: number;
	outputType?: string;
}

export interface AiTagInfo {
	currentTag: string;
	availableTags: string[];
}

export interface AiServiceResult {
	mainResult: any;
	telemetryData: AiTelemetryData | null;
	tagInfo: AiTagInfo;
	providerName: string;
	modelId: string;
}

// --- Configuration for Retries ---
const MAX_RETRIES = 2;
const INITIAL_RETRY_DELAY_MS = 1000;

const ROLE_SEQUENCES: Record<string, string[]> = {
	main: ['main', 'fallback', 'research'],
	research: ['research', 'fallback', 'main'],
	fallback: ['fallback', 'main', 'research']
};

const TOOL_USE_UNSUPPORTED = [
	'no endpoints found that support tool use',
	'does not support tool_use',
	'tool use is not supported',
	'tools are not supported',
	'function calling is not supported'
];

function calculateCost(
	inputTokens: number | undefined,
	outputTokens: number | undefined,
	inputCost: number,
	outputCost: number
): number {
	const calculatedCost =
		((inputTokens || 0) / 1_000_000) * inputCost +
		((outputTokens || 0) / 1_000_000) * outputCost;
	return parseFloat(calculatedCost.toFixed(6));
}

export class AiService {
	private claudeCodeProvider?: ClaudeCodeProvider;

	constructor(private readonly host: AiServiceHost) {
		// The AI SDK's warnings (deprecated APIs, settings a provider ignores) are for
		// TaskGraph's developers, not its users, and they break up spinners. Send them
		// to the debug log unless the embedding app chose its own handling.
		const g = globalThis as { AI_SDK_LOG_WARNINGS?: unknown };
		if (g.AI_SDK_LOG_WARNINGS === undefined) {
			g.AI_SDK_LOG_WARNINGS = ({
				warnings,
				provider,
				model
			}: {
				warnings: any[];
				provider?: string;
				model?: string;
			}) => {
				for (const warning of warnings) {
					const detail =
						warning.message ||
						warning.feature ||
						warning.setting ||
						warning.type;
					host.log(
						'debug',
						`AI SDK warning (${provider ?? '?'}/${model ?? '?'}): ${detail}`
					);
				}
			};
		}
	}

	generateText(params: AiServiceParams): Promise<AiServiceResult> {
		return this.run('generateText', { outputType: 'cli', ...params });
	}

	// Usage for a stream is only known once it ends; callers rebuild telemetry then
	streamText(params: AiServiceParams): Promise<AiServiceResult> {
		return this.run('streamText', { outputType: 'cli', ...params });
	}

	async streamObject(params: AiServiceParams): Promise<AiServiceResult> {
		if (!params.schema) {
			throw new Error('streamObjectService requires a schema parameter');
		}
		return this.run('streamObject', { outputType: 'cli', ...params });
	}

	generateObject(params: AiServiceParams): Promise<AiServiceResult> {
		return this.run('generateObject', {
			objectName: 'generated_object',
			outputType: 'cli',
			...params
		});
	}

	/** Builds the usage telemetry for a call: tokens, cost and who ran it */
	async logUsage({
		userId,
		commandName,
		providerName,
		modelId,
		inputTokens,
		outputTokens,
		cachedInputTokens
	}: AiUsageParams): Promise<AiTelemetryData | null> {
		try {
			const timestamp = new Date().toISOString();
			const totalTokens = (inputTokens || 0) + (outputTokens || 0);

			const { inputCost, outputCost, currency, isUnknown } =
				this.getCostForModel(providerName, modelId);

			const totalCost = calculateCost(
				inputTokens,
				outputTokens,
				inputCost,
				outputCost
			);

			const telemetryData: AiTelemetryData = {
				timestamp,
				userId,
				commandName,
				modelUsed: modelId, // Consistent field name from requirements
				providerName, // Keep provider name for context
				inputTokens: inputTokens || 0,
				outputTokens: outputTokens || 0,
				totalTokens,
				// Part of inputTokens read from the prompt cache
				...(cachedInputTokens && cachedInputTokens > 0
					? { cachedInputTokens }
					: {}),
				totalCost,
				currency,
				isUnknownCost: isUnknown // Flag to indicate if pricing is unknown
			};

			if (this.host.getDebugFlag()) {
				this.host.log('debug', 'AI Usage Telemetry:', telemetryData);
			}

			return telemetryData;
		} catch (error: any) {
			this.host.log(
				'error',
				`Failed to log AI usage telemetry: ${error.message}`,
				{ error }
			);
			// Don't re-throw; telemetry failure shouldn't block core functionality.
			return null;
		}
	}

	private getProvider(providerName: string | undefined) {
		if (providerName !== 'claude-code') return null;
		this.claudeCodeProvider ??= new ClaudeCodeProvider({
			log: this.host.log,
			getSettingsForCommand: this.host.getClaudeCodeSettingsForCommand,
			supportedModels: this.host.getSupportedModels('claude-code')
		});
		return this.claudeCodeProvider;
	}

	private getCostForModel(providerName: string, modelId: string) {
		const DEFAULT_COST = {
			inputCost: 0,
			outputCost: 0,
			currency: 'USD',
			isUnknown: false
		};
		const { log } = this.host;
		const modelMap = this.host.getModelMap();

		if (!modelMap || !modelMap[providerName]) {
			log(
				'warn',
				`Provider "${providerName}" not found in MODEL_MAP. Cannot determine cost for model ${modelId}.`
			);
			return { ...DEFAULT_COST, isUnknown: true };
		}

		const modelData = modelMap[providerName].find((m) => m.id === modelId);

		if (!modelData) {
			log(
				'debug',
				`Model "${modelId}" not found under provider "${providerName}". Assuming unknown cost.`
			);
			return { ...DEFAULT_COST, isUnknown: true };
		}

		// null or missing: pricing unknown
		const costs = modelData.cost_per_1m_tokens;
		if (!costs) {
			log(
				'debug',
				`Cost data not found for model "${modelId}" under provider "${providerName}". Pricing unknown.`
			);
			return { ...DEFAULT_COST, isUnknown: true };
		}

		return {
			inputCost: costs.input || 0,
			outputCost: costs.output || 0,
			currency: costs.currency || 'USD',
			isUnknown: false
		};
	}

	private getTagInfo(projectRoot: string | null | undefined): AiTagInfo {
		const DEFAULT_TAG_INFO = {
			currentTag: 'master',
			availableTags: ['master']
		};
		try {
			if (!projectRoot) {
				return DEFAULT_TAG_INFO;
			}
			const currentTag = this.host.getCurrentTag(projectRoot) || 'master';
			return { currentTag, availableTags: this.readAvailableTags(projectRoot) };
		} catch (error: any) {
			if (this.host.getDebugFlag()) {
				this.host.log(
					'debug',
					`Error getting tag information: ${error.message}`
				);
			}
			return DEFAULT_TAG_INFO;
		}
	}

	private readAvailableTags(projectRoot: string): string[] {
		const DEFAULT_TAGS = ['master'];
		try {
			// A missing file lands in the catch below
			const tasksData = JSON.parse(
				fs.readFileSync(path.join(projectRoot, TASKGRAPH_TASKS_FILE), 'utf8')
			);
			if (!tasksData || typeof tasksData !== 'object') {
				return DEFAULT_TAGS;
			}
			// Tagged format: tag keys whose value holds a tasks array
			const tags = Object.keys(tasksData).filter((key) =>
				Array.isArray(tasksData[key]?.tasks)
			);
			return tags.length > 0 ? tags : DEFAULT_TAGS;
		} catch (readError: any) {
			if (this.host.getDebugFlag()) {
				this.host.log(
					'debug',
					`Could not read tasks file for available tags: ${readError.message}`
				);
			}
			return DEFAULT_TAGS;
		}
	}

	private resolveApiKey(
		provider: ClaudeCodeProvider,
		providerName: string,
		session: unknown,
		projectRoot: string | null | undefined
	): string | null {
		const envVarName = provider.getRequiredApiKeyName();
		if (envVarName === null) {
			return null;
		}

		const apiKey = this.host.resolveEnvVariable(
			envVarName,
			session,
			projectRoot
		);

		// Providers that can use alternative auth or no API key
		if (!provider.isRequiredApiKey()) {
			return apiKey || null;
		}

		if (!apiKey) {
			throw new Error(
				`Required API key ${envVarName} for provider '${providerName}' is not set in environment, session, or .env file.`
			);
		}
		return apiKey;
	}

	private async callWithRetries(
		provider: ClaudeCodeProvider,
		serviceType: AiServiceType,
		callParams: Record<string, any>,
		providerName: string,
		modelId: string,
		attemptRole: string
	) {
		const { log, getDebugFlag } = this.host;
		let retries = 0;

		while (true) {
			try {
				if (getDebugFlag()) {
					log(
						'info',
						`Attempt ${retries + 1}/${MAX_RETRIES + 1} calling ${serviceType} (Provider: ${providerName}, Model: ${modelId}, Role: ${attemptRole})`
					);
				}

				const result = await (
					provider[serviceType] as (p: any) => Promise<any>
				)(callParams as any);

				if (getDebugFlag()) {
					log(
						'info',
						`${serviceType} succeeded for role ${attemptRole} (Provider: ${providerName}) on attempt ${retries + 1}`
					);
				}
				return result;
			} catch (error: any) {
				// The command prints the final error once; attempts are for --debug (#272)
				log(
					'debug',
					`Attempt ${retries + 1} failed for role ${attemptRole} (${serviceType} / ${providerName}): ${error?.message}`
				);

				if (isRetryableError(error) && retries < MAX_RETRIES) {
					retries++;
					const delay = INITIAL_RETRY_DELAY_MS * 2 ** (retries - 1);
					log(
						'info',
						`Something went wrong on the provider side. Retrying in ${delay / 1000}s...`
					);
					await new Promise((resolve) => setTimeout(resolve, delay));
				} else {
					log(
						'debug',
						`Something went wrong on the provider side. Max retries reached for role ${attemptRole} (${serviceType} / ${providerName}).`
					);
					throw error;
				}
			}
		}
	}

	private async run(
		serviceType: AiServiceType,
		params: AiServiceParams
	): Promise<AiServiceResult> {
		const {
			role: initialRole,
			session,
			projectRoot,
			systemPrompt,
			prompt,
			schema,
			objectName,
			commandName,
			outputType,
			experimental_transform,
			...restApiParams
		} = params;
		const { log } = this.host;
		if (this.host.getDebugFlag()) {
			log('debug', `${serviceType}Service called`, {
				role: initialRole,
				commandName,
				outputType,
				projectRoot
			});
		}

		const effectiveProjectRoot = projectRoot || this.host.findProjectRoot();
		const userId = this.host.getUserId(effectiveProjectRoot);

		let sequence = ROLE_SEQUENCES[initialRole];
		if (!sequence) {
			log(
				'warn',
				`Unknown initial role: ${initialRole}. Defaulting to main -> fallback -> research sequence.`
			);
			sequence = ROLE_SEQUENCES.main;
		}

		// provider/model pairs that already failed, so identical roles are not retried
		const failedModels = new Set<string>();
		let lastError: any;
		let lastCleanErrorMessage =
			'AI service call failed for all configured roles.';

		for (const currentRole of sequence) {
			let providerName: string | null | undefined;
			let modelId: string | null | undefined;

			try {
				log('debug', `New AI service call with role: ${currentRole}`);

				({ provider: providerName, modelId } = this.host.getRoleModel(
					currentRole,
					effectiveProjectRoot
				));

				if (!providerName || !modelId) {
					log(
						'warn',
						`Skipping role '${currentRole}': Provider or Model ID not configured.`
					);
					continue;
				}

				if (failedModels.has(`${providerName}/${modelId}`)) {
					log(
						'debug',
						`Skipping role '${currentRole}': ${providerName}/${modelId} already failed for this request.`
					);
					continue;
				}

				const provider = this.getProvider(providerName.toLowerCase());
				if (!provider) {
					log(
						'warn',
						`Skipping role '${currentRole}': Provider '${providerName}' not supported.`
					);
					continue;
				}

				const roleParams = this.host.getParametersForRole(
					currentRole,
					effectiveProjectRoot
				);
				const apiKey = this.resolveApiKey(
					provider,
					providerName.toLowerCase(),
					session,
					effectiveProjectRoot
				);

				const responseLanguage =
					this.host.getResponseLanguage(effectiveProjectRoot);
				const systemPromptWithLanguage = `${systemPrompt} \n\n Always respond in ${responseLanguage}.`;
				const messages = [
					{ role: 'system', content: systemPromptWithLanguage.trim() }
				];

				if (prompt) {
					messages.push({ role: 'user', content: prompt });
				} else {
					throw new Error('User prompt content is missing.');
				}

				const callParams = {
					apiKey,
					modelId,
					maxTokens: roleParams.maxTokens,
					temperature: roleParams.temperature,
					messages,
					...((serviceType === 'generateObject' ||
						serviceType === 'streamObject') && { schema, objectName }),
					role: currentRole, // Lets providers restrict capabilities per role
					projectRoot: effectiveProjectRoot, // Lets providers confine file access
					...(commandName && { commandName }), // Providers look up per-command settings by name
					...(experimental_transform ? { experimental_transform } : {}), // Pass smoothStream or other transforms
					...restApiParams
				};

				const providerResponse = await this.callWithRetries(
					provider,
					serviceType,
					callParams,
					providerName,
					modelId,
					currentRole
				);

				let telemetryData: AiTelemetryData | null = null;
				if (userId && providerResponse?.usage) {
					// logUsage logs its own errors and returns null on failure
					telemetryData = await this.logUsage({
						userId,
						commandName,
						providerName,
						modelId,
						inputTokens: providerResponse.usage.inputTokens,
						outputTokens: providerResponse.usage.outputTokens,
						cachedInputTokens: providerResponse.usage.cachedInputTokens,
						outputType
					});
				} else if (userId && providerResponse && !providerResponse.usage) {
					log(
						'warn',
						`Cannot log telemetry for ${commandName} (${providerName}/${modelId}): AI result missing 'usage' data. (May be expected for streams)`
					);
				}

				const mainResult =
					serviceType === 'generateText'
						? providerResponse.text
						: serviceType === 'generateObject'
							? providerResponse.object
							: providerResponse;

				return {
					mainResult,
					telemetryData,
					tagInfo: this.getTagInfo(effectiveProjectRoot),
					providerName,
					modelId
				};
			} catch (error: any) {
				const cleanMessage = extractErrorMessage(error);
				log(
					'debug',
					`Service call failed for role ${currentRole} (Provider: ${providerName || 'unknown'}, Model: ${modelId || 'unknown'}): ${cleanMessage}`
				);
				lastError = error;
				lastCleanErrorMessage = cleanMessage;
				// Another role would wait out a fresh timeout, or ignore the cancel
				if (isAbort(error)) throw error;
				if (providerName && modelId) {
					failedModels.add(`${providerName}/${modelId}`);
				}

				if (serviceType === 'generateObject') {
					const lowerCaseMessage = cleanMessage.toLowerCase();
					if (TOOL_USE_UNSUPPORTED.some((m) => lowerCaseMessage.includes(m))) {
						const specificErrorMsg = `Model '${modelId || 'unknown'}' via provider '${providerName || 'unknown'}' does not support the 'tool use' required by generateObjectService. Please configure a model that supports tool/function calling for the '${currentRole}' role, or use generateTextService if structured output is not strictly required.`;
						log('debug', `[Tool Support Error] ${specificErrorMsg}`);
						throw new Error(specificErrorMsg);
					}
				}
			}
		}

		log('debug', `All roles in the sequence [${sequence.join(', ')}] failed.`);
		// Keep what callers and retry checks read: name, status, the original
		throw Object.assign(
			new Error(lastCleanErrorMessage, { cause: lastError }),
			{
				...(typeof lastError?.name === 'string' && { name: lastError.name }),
				...(lastError?.status !== undefined && { status: lastError.status })
			}
		);
	}
}
