/**
 * @fileoverview Environment Configuration Provider
 * Extracts configuration from environment variables
 */

import type { PartialConfiguration } from '../../../common/interfaces/configuration.interface.js';
import { getLogger } from '../../../common/logger/index.js';
import type { EnvMap } from './project-env.js';

/**
 * Environment variable mapping definition
 */
interface EnvMapping {
	/** Environment variable name */
	env: string;
	/** Path in configuration object */
	path: readonly string[];
	/** Optional validator function */
	validate?: (value: string) => boolean;
	/** Whether this is runtime state (not configuration) */
	isRuntimeState?: boolean;
}

/**
 * EnvironmentConfigProvider extracts configuration from environment variables
 * Single responsibility: Environment variable configuration extraction
 */
export class EnvironmentConfigProvider {
	private readonly logger = getLogger('EnvironmentConfigProvider');

	/**
	 * Default environment variable mappings
	 */
	private static readonly DEFAULT_MAPPINGS: EnvMapping[] = [
		{ env: 'TASKGRAPH_MODEL_MAIN', path: ['models', 'main'] },
		{ env: 'TASKGRAPH_MODEL_RESEARCH', path: ['models', 'research'] },
		{ env: 'TASKGRAPH_MODEL_FALLBACK', path: ['models', 'fallback'] },
		{
			env: 'TASKGRAPH_RESPONSE_LANGUAGE',
			path: ['custom', 'responseLanguage']
		}
	];

	/**
	 * Runtime state mappings (separate from configuration)
	 */
	private static readonly RUNTIME_STATE_MAPPINGS: EnvMapping[] = [
		{ env: 'TASKGRAPH_TAG', path: ['activeTag'], isRuntimeState: true }
	];

	private mappings: EnvMapping[];

	constructor(
		private readonly env: EnvMap = process.env,
		customMappings?: EnvMapping[]
	) {
		this.mappings = customMappings || [
			...EnvironmentConfigProvider.DEFAULT_MAPPINGS,
			...EnvironmentConfigProvider.RUNTIME_STATE_MAPPINGS
		];
	}

	/**
	 * Load configuration from environment variables
	 */
	loadConfig(): PartialConfiguration {
		const config: PartialConfiguration = {};

		for (const mapping of this.mappings) {
			// Skip runtime state variables
			if (mapping.isRuntimeState) continue;

			const value = this.env[mapping.env];
			if (!value) continue;

			// Validate value if validator is provided
			if (mapping.validate && !mapping.validate(value)) {
				this.logger.warn(`Invalid value for ${mapping.env}: ${value}`);
				continue;
			}

			// Set the value in the config object
			this.setNestedProperty(config, mapping.path, value);
		}

		return config;
	}

	/**
	 * Get runtime state from environment variables
	 */
	getRuntimeState(): Record<string, string> {
		const state: Record<string, string> = {};

		for (const mapping of this.mappings) {
			if (!mapping.isRuntimeState) continue;

			const value = this.env[mapping.env];
			if (value) {
				const key = mapping.path[mapping.path.length - 1];
				state[key] = value;
			}
		}

		return state;
	}

	/**
	 * Helper to set a nested property in an object
	 */
	private setNestedProperty(
		obj: any,
		path: readonly string[],
		value: any
	): void {
		const lastKey = path[path.length - 1];
		const keys = path.slice(0, -1);

		let current = obj;
		for (const key of keys) {
			if (!current[key]) {
				current[key] = {};
			}
			current = current[key];
		}

		current[lastKey] = value;
	}

	/**
	 * Check if an environment variable is set
	 */
	hasEnvVar(envName: string): boolean {
		return this.env[envName] !== undefined;
	}

	/**
	 * Get all environment variables that match our prefix
	 */
	getAllTaskGraphEnvVars(): Record<string, string> {
		const vars: Record<string, string> = {};
		const prefix = 'TASKGRAPH_';

		for (const [key, value] of Object.entries(this.env)) {
			if (key.startsWith(prefix) && value !== undefined) {
				vars[key] = value;
			}
		}

		return vars;
	}

	/**
	 * Add a custom mapping
	 */
	addMapping(mapping: EnvMapping): void {
		this.mappings.push(mapping);
	}

	/**
	 * Get current mappings
	 */
	getMappings(): EnvMapping[] {
		return [...this.mappings];
	}
}
