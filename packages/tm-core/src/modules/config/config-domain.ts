/**
 * @fileoverview Config Domain Facade
 * Public API for configuration management
 */

import type {
	PartialConfiguration,
	RuntimeStorageConfig
} from '../../common/interfaces/configuration.interface.js';
import type { ConfigManager } from './managers/config-manager.js';
import {
	getAvailableModelsList,
	getModelConfiguration,
	setModel,
	setModels,
	setResponseLanguage
} from './services/project-settings.js';

/**
 * Config Domain - Unified API for configuration operations
 */
export class ConfigDomain {
	constructor(private configManager: ConfigManager) {}

	// ========== Configuration Access ==========

	/**
	 * Get the full configuration
	 */
	getConfig(): PartialConfiguration {
		return this.configManager.getConfig();
	}

	/**
	 * Get storage configuration
	 */
	getStorageConfig(): RuntimeStorageConfig {
		return this.configManager.getStorageConfig();
	}

	/**
	 * Get model configuration
	 */
	getModelConfig() {
		return this.configManager.getModelConfig();
	}

	/**
	 * Get response language
	 */
	getResponseLanguage(): string {
		return this.configManager.getResponseLanguage();
	}

	/**
	 * Get project root path
	 */
	getProjectRoot(): string {
		return this.configManager.getProjectRoot();
	}

	// ========== Runtime State ==========

	/**
	 * Get the currently active tag
	 */
	getActiveTag(): string {
		return this.configManager.getActiveTag();
	}

	/**
	 * Set the active tag
	 */
	async setActiveTag(tag: string): Promise<void> {
		return this.configManager.setActiveTag(tag);
	}

	// ========== Configuration Updates ==========

	/**
	 * Reset configuration to defaults
	 */
	async reset(): Promise<void> {
		return this.configManager.reset();
	}

	/**
	 * Each role's model. Throws when the project has no config.json.
	 * `onWarning` hears about a role whose provider isn't supported.
	 */
	getModelConfiguration(onWarning?: (message: string) => void) {
		return getModelConfiguration(this.configManager, onWarning);
	}

	/**
	 * The models a role can be set to. Throws when the project has no
	 * config.json.
	 */
	getAvailableModelsList() {
		return getAvailableModelsList(this.configManager.getProjectRoot());
	}

	/**
	 * Save a role's model to the project's config. Throws when the project
	 * has no config.json. This instance keeps the settings it loaded; a new
	 * one (createTmCore) reads the change.
	 */
	setModel(role: string, modelId: unknown) {
		return setModel(this.configManager.getProjectRoot(), role, modelId);
	}

	/**
	 * Save several roles' models: checks them all first, so one bad model
	 * saves none. Throws when the project has no config.json.
	 */
	setModels(requested: [role: string, modelId: unknown][]) {
		return setModels(this.configManager.getProjectRoot(), requested);
	}

	/**
	 * Save the language AI responses are written in. This instance keeps the
	 * settings it loaded; a new one reads the change.
	 */
	setResponseLanguage(language: unknown) {
		return setResponseLanguage(this.configManager.getProjectRoot(), language);
	}

	// ========== Utilities ==========

	/**
	 * Get configuration sources for debugging
	 */
	getConfigSources() {
		return this.configManager.getConfigSources();
	}
}
