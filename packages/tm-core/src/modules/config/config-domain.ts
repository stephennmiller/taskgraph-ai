/**
 * @fileoverview Config Domain Facade
 * Public API for configuration management
 */

import type {
	PartialConfiguration,
	RuntimeStorageConfig
} from '../../common/interfaces/configuration.interface.js';
import type { ConfigManager } from './managers/config-manager.js';

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

	// ========== Utilities ==========

	/**
	 * Get configuration sources for debugging
	 */
	getConfigSources() {
		return this.configManager.getConfigSources();
	}
}
