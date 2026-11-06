/**
 * @fileoverview Configuration interface definitions for the tm-core package
 * This file defines the contract for configuration management
 */

/**
 * Model configuration for different AI roles
 */
export interface ModelConfig {
	/** Primary model for task generation and updates */
	main: string;
	/** Research model for enhanced task analysis (optional) */
	research?: string;
	/** Fallback model when primary fails */
	fallback: string;
}

/**
 * AI provider configuration
 */
export interface ProviderConfig {
	/** Provider name (e.g., 'claude-code') */
	name: string;
	/** API key for the provider */
	apiKey?: string;
	/** Base URL override */
	baseUrl?: string;
	/** Custom configuration options */
	options?: Record<string, unknown>;
	/** Whether this provider is enabled */
	enabled?: boolean;
}

/**
 * Runtime storage configuration: what getStorageConfig() returns
 */
export interface RuntimeStorageConfig {
	/** Storage backend type: tasks are stored in the project's local file */
	type: 'file';
}

/**
 * Storage and persistence settings
 * Extended storage settings including file operation preferences
 */
export interface StorageSettings extends RuntimeStorageConfig {
	/** Enable automatic backups */
	enableBackup: boolean;
	/**
	 * Maximum number of backups to retain
	 * @minimum 0
	 */
	maxBackups: number;
	/** Enable compression for storage */
	enableCompression: boolean;
	/** File encoding for text files */
	encoding: BufferEncoding;
	/** Enable atomic file operations */
	atomicOperations: boolean;
}

/**
 * Main configuration interface for TaskGraph core
 */
export interface IConfiguration {
	/** Project root path */
	projectPath: string;

	/** Model configuration for different roles */
	models: ModelConfig;

	/** Provider configurations */
	providers: Record<string, ProviderConfig>;

	/** Storage configuration */
	storage: StorageSettings;

	/** Custom user-defined settings */
	custom?: Record<string, unknown>;

	/** Configuration version for migration purposes */
	version: string;

	/** Last updated timestamp */
	lastUpdated: string;
}

/**
 * Partial configuration for updates (all fields optional)
 */
export type PartialConfiguration = Partial<IConfiguration>;

/**
 * Constants for default configuration values
 */
export const DEFAULT_CONFIG_VALUES = {
	MODELS: {
		MAIN: 'claude-sonnet-5-5',
		FALLBACK: 'claude-sonnet-5-5'
	},
	TAGS: {
		DEFAULT_TAG: 'master'
	},
	STORAGE: {
		TYPE: 'file' as const,
		ENCODING: 'utf8' as BufferEncoding,
		MAX_BACKUPS: 5
	},
	VERSION: '1.0.0'
} as const;
