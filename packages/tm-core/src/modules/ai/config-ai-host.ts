/**
 * @fileoverview The AiService host for tm-core's own commands: role models,
 * model parameters, Claude Code settings and API-key lookup read from
 * ConfigManager, the way the legacy config-manager.js reads them (its role
 * defaults, the supported-models.json token caps, the claudeCode schema).
 */

import fs from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';
import {
	CUSTOM_PROVIDERS,
	CUSTOM_PROVIDERS_ARRAY
} from '../../common/constants/providers.js';
import { getLogger } from '../../common/logger/index.js';
import type { ConfigManager } from '../config/managers/config-manager.js';
import type { AiServiceHost } from './ai-service.js';
import { ClaudeCodeSettingsSchema } from './claude-code-settings.js';
import supportedModels from './supported-models.json' with { type: 'json' };

/** A model entry in supported-models.json */
export interface SupportedModel {
	id: string;
	swe_score?: number | null;
	cost_per_1m_tokens?: { input?: number; output?: number } | null;
	allowed_roles?: string[];
	max_tokens?: number;
	temperature?: number;
	supported?: boolean;
}

/** supported-models.json, keyed by provider */
export const SUPPORTED_MODELS: Record<string, SupportedModel[]> =
	supportedModels;

export type AiRole = 'main' | 'research' | 'fallback';

interface RoleModel {
	provider: string;
	modelId: string;
	maxTokens: number;
	temperature: number;
}

const DEFAULT_ROLE_MODELS: Record<AiRole, RoleModel> = {
	main: {
		provider: 'claude-code',
		modelId: 'sonnet',
		maxTokens: 64000,
		temperature: 0.2
	},
	research: {
		provider: 'claude-code',
		modelId: 'sonnet',
		maxTokens: 8700,
		temperature: 0.1
	},
	fallback: {
		provider: 'claude-code',
		modelId: 'sonnet',
		maxTokens: 64000,
		temperature: 0.2
	}
};

/** The parts of .taskgraph/config.json this host reads */
interface RawAiConfig {
	models?: Partial<Record<AiRole, unknown>>;
	global?: {
		debug?: unknown;
		userId?: unknown;
		enableCodebaseAnalysis?: unknown;
		defaultPriority?: unknown;
	};
	claudeCode?: unknown;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Reads AI settings from a project's config. Each getter reads the config
 * at call time, so it matches what ConfigManager loaded.
 */
export class AiConfig {
	private readonly logger = getLogger('AiConfig');
	private claudeCodeSettings?: Record<string, any>;

	constructor(private readonly configManager: ConfigManager) {}

	private get raw(): RawAiConfig {
		return this.configManager.getConfig() as RawAiConfig;
	}

	get projectRoot(): string {
		return this.configManager.getProjectRoot();
	}

	/**
	 * A role's model, over the defaults. A fallback counts only with both a
	 * provider and a model ID; an unsupported provider falls back to the
	 * default model with a warning.
	 */
	roleModel(role: AiRole): RoleModel {
		const defaults = DEFAULT_ROLE_MODELS[role];
		// TASKGRAPH_MODEL_* set a role to a bare string, which names no provider
		const entry = this.raw.models?.[role];
		const configured = isObject(entry) ? entry : {};
		if (role === 'fallback' && !(configured.provider && configured.modelId)) {
			return { ...defaults };
		}
		const model = { ...defaults, ...configured } as RoleModel;
		if (!CUSTOM_PROVIDERS_ARRAY.includes(model.provider as never)) {
			this.logger.warn(
				`${role} provider "${model.provider}" isn't supported; using ${defaults.modelId}`
			);
			return { ...defaults };
		}
		return model;
	}

	/** maxTokens capped at the model's limit in supported-models.json, and temperature */
	parametersForRole(role: AiRole) {
		const { provider, modelId, maxTokens, temperature } = this.roleModel(role);
		const model = SUPPORTED_MODELS[provider]?.find((m) => m.id === modelId);
		return {
			maxTokens:
				typeof model?.max_tokens === 'number' && model.max_tokens > 0
					? Math.min(maxTokens, model.max_tokens)
					: maxTokens,
			temperature:
				typeof model?.temperature === 'number' &&
				model.temperature >= 0 &&
				model.temperature <= 1
					? model.temperature
					: temperature
		};
	}

	get debug(): boolean {
		return this.raw.global?.debug === true;
	}

	get userId(): string {
		// shortcut: the legacy loader also saved this default into config.json; nothing here writes config
		const id = this.raw.global?.userId;
		return typeof id === 'string' && id ? id : '1234567890';
	}

	get defaultPriority(): string | undefined {
		const priority = this.raw.global?.defaultPriority;
		return typeof priority === 'string' ? priority : undefined;
	}

	/** `claudeCode` merged with the command's `commandSpecific` entry */
	claudeCodeSettingsFor(commandName?: string): Record<string, any> {
		if (!this.claudeCodeSettings) {
			const raw = this.raw.claudeCode;
			const parsed = ClaudeCodeSettingsSchema.safeParse(
				isObject(raw) ? raw : {}
			);
			if (!parsed.success) {
				this.logger.warn(
					`Invalid Claude Code settings in config: ${parsed.error.message}. Falling back to default.`
				);
			}
			this.claudeCodeSettings = parsed.success ? parsed.data : {};
		}
		const { commandSpecific, ...settings } = this.claudeCodeSettings;
		// commandSpecific itself is not a provider setting; the SDK rejects it
		return {
			...settings,
			...(commandName ? commandSpecific?.[commandName] : undefined)
		};
	}

	/** A variable from the MCP session, then the project's .env, then process.env */
	resolveEnv(name: string, session?: unknown): string | undefined {
		const fromSession = (session as { env?: Record<string, string> })?.env?.[
			name
		];
		if (fromSession) return fromSession;
		try {
			const fromFile = parseEnv(
				fs.readFileSync(path.join(this.projectRoot, '.env'), 'utf-8')
			)[name];
			if (fromFile) return fromFile;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
				this.logger.warn(
					`Could not read or parse ${path.join(this.projectRoot, '.env')}: ${(error as Error).message}`
				);
			}
		}
		return process.env[name] || undefined;
	}

	/**
	 * Whether the model may explore the codebase: on unless
	 * TASKGRAPH_ENABLE_CODEBASE_ANALYSIS or `global.enableCodebaseAnalysis`
	 * turns it off, never for research (web tools only), and only with
	 * Claude Code as the main provider.
	 */
	hasCodebaseAnalysis(useResearch: boolean, session?: unknown): boolean {
		const flag = this.resolveEnv('TASKGRAPH_ENABLE_CODEBASE_ANALYSIS', session);
		const enabled = flag
			? flag.toLowerCase() === 'true' || flag === '1'
			: this.raw.global?.enableCodebaseAnalysis !== false;
		if (!enabled || useResearch) return false;
		return this.roleModel('main').provider === CUSTOM_PROVIDERS.CLAUDE_CODE;
	}

	/** The AiService host over this config */
	toHost(): AiServiceHost {
		const logger = getLogger('AI');
		return {
			log: (level, message, ...args) => logger[level](message, ...args),
			getDebugFlag: () => this.debug,
			findProjectRoot: () => this.projectRoot,
			getRoleModel: (role) => this.roleModel(role as AiRole),
			getParametersForRole: (role) => this.parametersForRole(role as AiRole),
			getResponseLanguage: () => this.configManager.getResponseLanguage(),
			getUserId: () => this.userId,
			getCurrentTag: () => this.configManager.getActiveTag(),
			resolveEnvVariable: (name, session) => this.resolveEnv(name, session),
			getClaudeCodeSettingsForCommand: (commandName) =>
				this.claudeCodeSettingsFor(commandName),
			getSupportedModels: (provider) =>
				(SUPPORTED_MODELS[provider] ?? [])
					.filter((model) => model.supported !== false)
					.map((model) => model.id),
			getModelMap: () => SUPPORTED_MODELS
		};
	}
}
