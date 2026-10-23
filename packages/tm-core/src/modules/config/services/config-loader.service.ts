/**
 * @fileoverview Configuration Loader Service
 * Responsible for loading configuration from various file sources
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import {
	ERROR_CODES,
	TaskGraphError
} from '../../../common/errors/taskgraph-error.js';
import type { PartialConfiguration } from '../../../common/interfaces/configuration.interface.js';
import { DEFAULT_CONFIG_VALUES } from '../../../common/interfaces/configuration.interface.js';
import { TASKGRAPH_LOCAL_CONFIG_FILE } from '../../../common/constants/paths.js';
import { getLogger } from '../../../common/logger/index.js';
import { mergeMachineConfig } from './machine-config.js';

/**
 * ConfigLoader handles loading configuration from files
 * Single responsibility: File-based configuration loading
 */
export class ConfigLoader {
	private localConfigPath: string;
	private machineConfigPath: string;
	private globalConfigPath: string;
	private readonly logger = getLogger('ConfigLoader');

	constructor(projectRoot: string) {
		this.localConfigPath = path.join(projectRoot, '.taskgraph', 'config.json');
		this.machineConfigPath = path.join(
			projectRoot,
			TASKGRAPH_LOCAL_CONFIG_FILE
		);
		this.globalConfigPath = path.join(
			process.env.HOME || '',
			'.taskgraph',
			'config.json'
		);
	}

	/**
	 * Get default configuration values
	 */
	getDefaultConfig(): PartialConfiguration {
		return {
			models: {
				main: DEFAULT_CONFIG_VALUES.MODELS.MAIN,
				fallback: DEFAULT_CONFIG_VALUES.MODELS.FALLBACK
			},
			storage: {
				type: DEFAULT_CONFIG_VALUES.STORAGE.TYPE,
				encoding: DEFAULT_CONFIG_VALUES.STORAGE.ENCODING,
				enableBackup: false,
				maxBackups: DEFAULT_CONFIG_VALUES.STORAGE.MAX_BACKUPS,
				enableCompression: false,
				atomicOperations: true
			},
			version: DEFAULT_CONFIG_VALUES.VERSION
		};
	}

	/**
	 * Load the project configuration: .taskgraph/config.json with this
	 * machine's .taskgraph/config.local.json merged over it
	 */
	async loadLocalConfig(): Promise<PartialConfiguration | null> {
		const shared = await this.readConfigFile(this.localConfigPath);
		if (!shared) {
			this.logger.debug('No local config.json found, using defaults');
		}
		const machine = await this.readMachineConfig();
		if (!shared && !machine) return null;
		return mergeMachineConfig(shared, machine);
	}

	/**
	 * Read config.local.json. A broken file is skipped with a warning so
	 * config.json still applies, as the legacy loader does.
	 */
	private async readMachineConfig(): Promise<PartialConfiguration | null> {
		try {
			return await this.readConfigFile(this.machineConfigPath);
		} catch (error: any) {
			this.logger.warn(
				`Couldn't read ${TASKGRAPH_LOCAL_CONFIG_FILE}, using config.json only: ${error.cause?.message ?? error.message}`
			);
			return null;
		}
	}

	/** Parse a config file; null when it doesn't exist */
	private async readConfigFile(
		configPath: string
	): Promise<PartialConfiguration | null> {
		try {
			const configData = await fs.readFile(configPath, 'utf-8');
			return JSON.parse(configData);
		} catch (error: any) {
			if (error.code === 'ENOENT') return null;
			throw new TaskGraphError(
				'Failed to load local configuration',
				ERROR_CODES.CONFIG_ERROR,
				{ configPath },
				error
			);
		}
	}

	/**
	 * Load global user configuration
	 * @future-implementation Full implementation pending
	 */
	async loadGlobalConfig(): Promise<PartialConfiguration | null> {
		// TODO: Implement in future PR
		// For now, return null to indicate no global config
		return null;

		// Future implementation:
		// try {
		//   const configData = await fs.readFile(this.globalConfigPath, 'utf-8');
		//   return JSON.parse(configData);
		// } catch (error: any) {
		//   if (error.code === 'ENOENT') {
		//     return null;
		//   }
		//   throw new TaskGraphError(
		//     'Failed to load global configuration',
		//     ERROR_CODES.CONFIG_ERROR,
		//     { configPath: this.globalConfigPath },
		//     error
		//   );
		// }
	}

	/**
	 * Check if local config exists
	 */
	async hasLocalConfig(): Promise<boolean> {
		try {
			await fs.access(this.localConfigPath);
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Check if global config exists
	 */
	async hasGlobalConfig(): Promise<boolean> {
		try {
			await fs.access(this.globalConfigPath);
			return true;
		} catch {
			return false;
		}
	}
}
