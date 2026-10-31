/**
 * @fileoverview Configuration Manager
 * Orchestrates configuration services following clean architecture principles
 *
 * This ConfigManager delegates responsibilities to specialized services for better
 * maintainability, testability, and separation of concerns.
 */

import type {
	PartialConfiguration,
	RuntimeStorageConfig
} from '../../../common/interfaces/configuration.interface.js';
import { DEFAULT_CONFIG_VALUES as DEFAULTS } from '../../../common/interfaces/configuration.interface.js';
import { getLogger } from '../../../common/logger/index.js';
import { normalizeDefinitionOfDone } from '../../tasks/utils/acceptance-criteria.js';
import { DEFAULT_ARCHIVE_AFTER_DAYS } from '../../tasks/utils/archive.js';
import { ConfigLoader } from '../services/config-loader.service.js';
import {
	CONFIG_PRECEDENCE,
	ConfigMerger
} from '../services/config-merger.service.js';
import { ConfigPersistence } from '../services/config-persistence.service.js';
import { EnvironmentConfigProvider } from '../services/environment-config-provider.service.js';
import { isLanguageName } from '../services/project-settings.js';
import { readProjectEnv } from '../services/project-env.js';
import { RuntimeStateManager } from '../services/runtime-state-manager.service.js';

/**
 * ConfigManager orchestrates all configuration services
 *
 * This class delegates responsibilities to specialized services:
 * - ConfigLoader: Loads configuration from files
 * - ConfigMerger: Merges configurations with precedence
 * - RuntimeStateManager: Manages runtime state
 * - ConfigPersistence: Deletes the config files on reset
 * - EnvironmentConfigProvider: Extracts env var configuration
 */
export class ConfigManager {
	private projectRoot: string;
	private config: PartialConfiguration = {};
	private initialized = false;
	private warnedResponseLanguage = false;

	// Services
	private loader: ConfigLoader;
	private merger: ConfigMerger;
	private stateManager: RuntimeStateManager;
	private persistence: ConfigPersistence;
	private envProvider: EnvironmentConfigProvider;

	/**
	 * Create and initialize a new ConfigManager instance
	 * This is the ONLY way to create a ConfigManager
	 *
	 * @param projectRoot - The root directory of the project
	 * @returns Fully initialized ConfigManager instance
	 */
	static async create(projectRoot: string): Promise<ConfigManager> {
		const manager = new ConfigManager(projectRoot);
		await manager.initialize();
		return manager;
	}

	/**
	 * Private constructor - use ConfigManager.create() instead
	 * This ensures the ConfigManager is always properly initialized
	 */
	private constructor(projectRoot: string) {
		this.projectRoot = projectRoot;

		// Initialize services
		this.loader = new ConfigLoader(projectRoot);
		this.merger = new ConfigMerger();
		const env = readProjectEnv(projectRoot);
		this.stateManager = new RuntimeStateManager(projectRoot, env);
		this.persistence = new ConfigPersistence(projectRoot);
		this.envProvider = new EnvironmentConfigProvider(undefined, env);
	}

	/**
	 * Initialize by loading configuration from all sources
	 * Private - only called by the factory method
	 */
	private async initialize(): Promise<void> {
		if (this.initialized) return;

		// Clear any existing configuration sources
		this.merger.clearSources();

		// 1. Load default configuration (lowest precedence)
		this.merger.addSource({
			name: 'defaults',
			config: this.loader.getDefaultConfig(),
			precedence: CONFIG_PRECEDENCE.DEFAULTS
		});

		// 2. Load global configuration (if exists)
		const globalConfig = await this.loader.loadGlobalConfig();
		if (globalConfig) {
			this.merger.addSource({
				name: 'global',
				config: globalConfig,
				precedence: CONFIG_PRECEDENCE.GLOBAL
			});
		}

		// 3. Load local project configuration
		const localConfig = await this.loader.loadLocalConfig();
		if (localConfig) {
			this.merger.addSource({
				name: 'local',
				config: localConfig,
				precedence: CONFIG_PRECEDENCE.LOCAL
			});
		}

		// 4. Load environment variables (highest precedence)
		const envConfig = this.envProvider.loadConfig();
		if (Object.keys(envConfig).length > 0) {
			this.merger.addSource({
				name: 'environment',
				config: envConfig,
				precedence: CONFIG_PRECEDENCE.ENVIRONMENT
			});
		}

		// 5. Merge all configurations
		this.config = this.merger.merge();

		// 6. Load runtime state
		await this.stateManager.loadState();

		this.initialized = true;
	}

	// ==================== Configuration Access ====================

	/**
	 * Get full configuration
	 */
	getConfig(): PartialConfiguration {
		return this.config;
	}

	/**
	 * Get storage configuration
	 */
	getStorageConfig(): RuntimeStorageConfig {
		const storage = this.config.storage;

		// Tasks are always stored in a local file. Configs written for the
		// removed cloud storage ('api' or 'auto') fall back to it with a warning.
		const configuredType: string | undefined = storage?.type;
		if (configuredType && configuredType !== 'file') {
			getLogger('ConfigManager').warn(
				`Storage type "${configuredType}" is no longer supported; using local file storage (.taskgraph/tasks/tasks.json).`
			);
		}

		if (storage && 'basePath' in storage) {
			getLogger('ConfigManager').debug(
				'Ignoring storage.basePath in config.json: tasks are always stored in this project.'
			);
		}

		return { type: 'file' };
	}

	/**
	 * Get model configuration
	 */
	getModelConfig() {
		return (
			this.config.models || {
				main: DEFAULTS.MODELS.MAIN,
				fallback: DEFAULTS.MODELS.FALLBACK
			}
		);
	}

	/**
	 * Response language (`global.responseLanguage`, where `lang` writes it);
	 * English when unset or not a language name, since it goes into every AI
	 * system prompt verbatim
	 */
	getResponseLanguage(): string {
		const raw = (this.config as { global?: { responseLanguage?: unknown } })
			.global?.responseLanguage;
		const language = typeof raw === 'string' ? raw.trim() : raw;
		if (!language) return 'English';
		if (isLanguageName(language)) return language;
		if (!this.warnedResponseLanguage) {
			this.warnedResponseLanguage = true;
			getLogger('ConfigManager').warn(
				'global.responseLanguage is not a language name (letters, spaces and hyphens, up to 40 characters); responding in English. Fix it with `taskgraph lang --response <language>`.'
			);
		}
		return 'English';
	}

	/**
	 * Project name (`global.projectName`), as the legacy getProjectName read
	 * it; 'TaskGraph' when unset
	 */
	getProjectName(): string {
		const global = (this.config as { global?: { projectName?: unknown } })
			.global;
		return typeof global?.projectName === 'string'
			? global.projectName
			: 'TaskGraph';
	}

	/**
	 * The project's Definition of Done (`global.definitionOfDone` in
	 * .taskgraph/config.json): checklist items every task must clear before
	 * it can be marked done. Empty when unset or not a list of strings.
	 */
	getDefinitionOfDone(): string[] {
		const global = (this.config as { global?: { definitionOfDone?: unknown } })
			.global;
		return normalizeDefinitionOfDone(global?.definitionOfDone);
	}

	/**
	 * Days a done or cancelled task stays in tasks.json before `archive`
	 * moves it (`global.archiveAfterDays`); 30 when unset or invalid
	 */
	getArchiveAfterDays(): number {
		const global = (this.config as { global?: { archiveAfterDays?: unknown } })
			.global;
		const days = Number(global?.archiveAfterDays);
		return Number.isInteger(days) && days >= 0
			? days
			: DEFAULT_ARCHIVE_AFTER_DAYS;
	}

	/**
	 * Get project root path
	 */
	getProjectRoot(): string {
		return this.projectRoot;
	}

	// ==================== Runtime State ====================

	/**
	 * Get the currently active tag
	 */
	getActiveTag(): string {
		return this.stateManager.getCurrentTag();
	}

	/**
	 * Set the active tag
	 */
	async setActiveTag(tag: string): Promise<void> {
		await this.stateManager.setCurrentTag(tag);
	}

	// ==================== Utilities ====================

	/**
	 * Reset configuration to defaults
	 */
	async reset(): Promise<void> {
		// Delete config.json and config.local.json
		await this.persistence.deleteConfig();

		// Clear runtime state
		await this.stateManager.clearState();

		// Reset internal state
		this.initialized = false;
		this.config = {};

		// Re-initialize with defaults
		await this.initialize();
	}

	/**
	 * Get configuration sources for debugging
	 */
	getConfigSources() {
		return this.merger.getSources();
	}
}
