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
import { readProjectEnv } from '../services/project-env.js';
import { RuntimeStateManager } from '../services/runtime-state-manager.service.js';

/**
 * ConfigManager orchestrates all configuration services
 *
 * This class delegates responsibilities to specialized services:
 * - ConfigLoader: Loads configuration from files
 * - ConfigMerger: Merges configurations with precedence
 * - RuntimeStateManager: Manages runtime state
 * - ConfigPersistence: Handles file persistence
 * - EnvironmentConfigProvider: Extracts env var configuration
 */
export class ConfigManager {
	private projectRoot: string;
	private config: PartialConfiguration = {};
	private initialized = false;

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

		return {
			type: 'file',
			basePath: storage?.basePath ?? this.projectRoot
		};
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
	 * Get response language setting
	 */
	getResponseLanguage(): string {
		const customConfig = this.config.custom as any;
		return customConfig?.responseLanguage || 'English';
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

	// ==================== Configuration Updates ====================

	/**
	 * Update configuration
	 */
	async updateConfig(updates: PartialConfiguration): Promise<void> {
		// Merge updates into current config
		Object.assign(this.config, updates);

		// Save to persistence
		await this.persistence.saveConfig(this.config);

		// Re-initialize to respect precedence
		this.initialized = false;
		await this.initialize();
	}

	/**
	 * Set response language
	 */
	async setResponseLanguage(language: string): Promise<void> {
		if (!this.config.custom) {
			this.config.custom = {};
		}
		(this.config.custom as any).responseLanguage = language;
		await this.persistence.saveConfig(this.config);
	}

	/**
	 * Save current configuration
	 */
	async saveConfig(): Promise<void> {
		await this.persistence.saveConfig(this.config, {
			createBackup: true,
			atomic: true
		});
	}

	// ==================== Utilities ====================

	/**
	 * Reset configuration to defaults
	 */
	async reset(): Promise<void> {
		// Clear configuration file
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
