/**
 * @fileoverview The settings `models` and `lang` (and their MCP tools) read
 * and change: each role's Claude Code model and the response language.
 * Results keep the `{ success, data | error }` shape the MCP replies carry.
 */

import fs from 'node:fs';
import path from 'node:path';
import {
	TASKGRAPH_CONFIG_FILE,
	TASKGRAPH_LOCAL_CONFIG_FILE
} from '../../../common/constants/paths.js';
import { CUSTOM_PROVIDERS } from '../../../common/constants/providers.js';
import {
	AiConfig,
	type AiRole,
	SUPPORTED_MODELS
} from '../../ai/config-ai-host.js';
import type { ConfigManager } from '../managers/config-manager.js';
import {
	dropOldNumTasksDefault,
	readConfigJson,
	UNREADABLE_CONFIG,
	writeSplitConfig
} from './config-file.js';
import { mergeMachineConfig } from './machine-config.js';

export type SettingResult<T> =
	| { success: true; data: T }
	| { success: false; error: { code: string; message: string } };

/** A Claude Code model as `models` lists it */
export interface AvailableModel {
	id: string;
	name: string;
	provider: string;
	swe_score?: number | null;
	cost_per_1m_tokens?: { input?: number; output?: number } | null;
	allowed_roles: string[];
	max_tokens?: number;
}

/** A role's model, with the score and cost supported-models.json gives it */
export interface ActiveModel {
	provider: string;
	modelId: string;
	sweScore: number | null;
	cost: { input?: number; output?: number } | null;
}

export const MODEL_ROLES: AiRole[] = ['main', 'research', 'fallback'];

const CONFIG_MISSING_ERROR =
	'The configuration file is missing. Run "taskgraph init" to create it.';

/** Whether the project has a .taskgraph/config.json */
export function isConfigFilePresent(projectRoot: string): boolean {
	return fs.existsSync(path.join(projectRoot, TASKGRAPH_CONFIG_FILE));
}

function assertConfigPresent(projectRoot: string): void {
	if (!projectRoot) {
		throw new Error('Project root is required but not found.');
	}
	if (!isConfigFilePresent(projectRoot)) throw new Error(CONFIG_MISSING_ERROR);
}

/** The supported models in supported-models.json, every provider */
export function getAvailableModels(): AvailableModel[] {
	return Object.entries(SUPPORTED_MODELS).flatMap(([provider, models]) =>
		models
			.filter((model) => Boolean(model.supported))
			.map((model) => ({
				id: model.id,
				name:
					(model as { name?: string }).name ||
					model.id
						.split('-')
						.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
						.join(' '),
				provider,
				swe_score: model.swe_score,
				cost_per_1m_tokens: model.cost_per_1m_tokens,
				allowed_roles: model.allowed_roles || ['main', 'fallback'],
				max_tokens: model.max_tokens
			}))
	);
}

/**
 * Each role's model as the project's config sets it, over the defaults.
 * `onWarning` hears about a role whose provider isn't supported.
 */
export function getModelConfiguration(
	configManager: ConfigManager,
	onWarning?: (message: string) => void
): SettingResult<{
	activeModels: Record<AiRole, ActiveModel>;
	message: string;
}> {
	const projectRoot = configManager.getProjectRoot();
	assertConfigPresent(projectRoot);
	// The loader skips a broken config.local.json; say so, as legacy did
	if (
		readConfigJson(path.join(projectRoot, TASKGRAPH_LOCAL_CONFIG_FILE)) ===
		UNREADABLE_CONFIG
	) {
		onWarning?.(
			`Couldn't read ${TASKGRAPH_LOCAL_CONFIG_FILE}, using config.json only`
		);
	}
	const available = getAvailableModels();
	const config = new AiConfig(configManager, (level, message) => {
		if (level === 'warn') onWarning?.(message);
	});
	const describe = (role: AiRole): ActiveModel => {
		const { provider, modelId } = config.roleModel(role);
		const model = available.find(
			(m) => m.id === modelId && m.provider === provider
		);
		return {
			provider,
			modelId,
			sweScore: model?.swe_score || null,
			cost: model?.cost_per_1m_tokens || null
		};
	};
	return {
		success: true,
		data: {
			activeModels: {
				main: describe('main'),
				research: describe('research'),
				fallback: describe('fallback')
			},
			message: 'Successfully retrieved current model configuration'
		}
	};
}

/** The models a role can be set to */
export function getAvailableModelsList(projectRoot: string): SettingResult<{
	models: {
		provider: string;
		modelId: string;
		sweScore: number | null;
		cost: { input?: number; output?: number } | null;
		allowedRoles: string[];
	}[];
	message: string;
}> {
	assertConfigPresent(projectRoot);
	const models = getAvailableModels().map((model) => ({
		provider: model.provider || 'N/A',
		modelId: model.id,
		sweScore: model.swe_score || null,
		cost: model.cost_per_1m_tokens || null,
		allowedRoles: model.allowed_roles || []
	}));
	return {
		success: true,
		data: {
			models,
			message: models.length
				? `Successfully retrieved ${models.length} available models`
				: 'No available models found'
		}
	};
}

/**
 * Set a role's Claude Code model, keeping the role's other settings
 * (temperature). The model's token limit becomes the role's maxTokens.
 */
export function setModel(
	projectRoot: string,
	role: string,
	modelId: unknown
): SettingResult<{
	role: string;
	provider: string;
	modelId: string;
	message: string;
}> {
	assertConfigPresent(projectRoot);
	if (!MODEL_ROLES.includes(role as AiRole)) {
		return failure(
			'INVALID_ROLE',
			`Invalid role: ${role}. Must be one of: ${MODEL_ROLES.join(', ')}.`
		);
	}
	if (typeof modelId !== 'string' || modelId.trim() === '') {
		return failure(
			'INVALID_MODEL_ID',
			`Invalid model ID: ${modelId}. Must be a non-empty string.`
		);
	}

	const provider = CUSTOM_PROVIDERS.CLAUDE_CODE;
	const supported = getAvailableModels().filter((m) => m.provider === provider);
	const model = supported.find((m) => m.id === modelId);
	if (!model) {
		return failure(
			'MODEL_NOT_FOUND',
			`Model ID "${modelId}" is not supported. TaskGraph uses Claude Code; valid models: ${supported.map((m) => m.id).join(', ')}.`
		);
	}

	const written = updateProjectConfig(projectRoot, (config) => {
		config.models ??= {};
		// Keep existing params like temperature
		const entry = { ...config.models[role], provider, modelId };
		delete entry.baseURL;
		if (model.max_tokens) entry.maxTokens = model.max_tokens;
		config.models[role] = entry;
	});
	if (!written.success) return written;

	return {
		success: true,
		data: {
			role,
			provider,
			modelId,
			message: `Successfully set ${role} model to ${modelId} (Provider: ${provider})`
		}
	};
}

/** Set the language AI responses are written in */
export function setResponseLanguage(
	projectRoot: string,
	language: unknown
): SettingResult<{ responseLanguage: string; message: string }> {
	if (!isConfigFilePresent(projectRoot)) {
		return failure('CONFIG_MISSING', CONFIG_MISSING_ERROR);
	}
	if (typeof language !== 'string' || language.trim() === '') {
		return failure(
			'INVALID_RESPONSE_LANGUAGE',
			`Invalid response language: ${language}. Must be a non-empty string.`
		);
	}
	const written = updateProjectConfig(projectRoot, (config) => {
		config.global = { ...config.global, responseLanguage: language };
	});
	if (!written.success) return written;
	return {
		success: true,
		data: {
			responseLanguage: language,
			message: `Response language set to ${language}`
		}
	};
}

/**
 * Change the project's config (config.json with config.local.json over it)
 * and save it through writeSplitConfig, which keeps per-machine settings in
 * the local file
 */
function updateProjectConfig(
	projectRoot: string,
	change: (config: Record<string, any>) => void
): SettingResult<never> | { success: true } {
	try {
		const shared = readConfigJson(
			path.join(projectRoot, TASKGRAPH_CONFIG_FILE)
		);
		const local = readConfigJson(
			path.join(projectRoot, TASKGRAPH_LOCAL_CONFIG_FILE)
		);
		if (shared === UNREADABLE_CONFIG) {
			return failure(
				'CONFIG_WRITE_ERROR',
				`${TASKGRAPH_CONFIG_FILE} isn't valid JSON; fix it before changing settings`
			);
		}
		// A file an old release saved keeps its cleanup, as the legacy loader does
		const config = mergeMachineConfig<Record<string, any>>(
			dropOldNumTasksDefault(shared) ?? shared,
			local === UNREADABLE_CONFIG ? null : local
		);
		change(config);
		writeSplitConfig(projectRoot, config);
	} catch (error) {
		return failure(
			'CONFIG_WRITE_ERROR',
			`Error writing updated configuration to configuration file: ${(error as Error).message}`
		);
	}
	return { success: true };
}

function failure(code: string, message: string) {
	return { success: false as const, error: { code, message } };
}
