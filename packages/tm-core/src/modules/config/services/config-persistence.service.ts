/**
 * @fileoverview Configuration Persistence Service
 * Handles saving and backup of configuration files
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import {
	ERROR_CODES,
	TaskGraphError
} from '../../../common/errors/taskgraph-error.js';
import type { PartialConfiguration } from '../../../common/interfaces/configuration.interface.js';
import { TASKGRAPH_LOCAL_CONFIG_FILE } from '../../../common/constants/paths.js';
import { getLogger } from '../../../common/logger/index.js';
import { ConfigLoader } from './config-loader.service.js';
import { splitMachineConfig } from './machine-config.js';

/** A file that exists but isn't valid JSON */
const UNREADABLE = Symbol('unreadable');

/**
 * Persistence options
 */
export interface PersistenceOptions {
	/** Enable backup before saving */
	createBackup?: boolean;
	/** Maximum number of backups to keep */
	maxBackups?: number;
	/** Use atomic write operations */
	atomic?: boolean;
}

/**
 * ConfigPersistence handles all configuration file I/O operations
 * Single responsibility: Configuration persistence
 */
export class ConfigPersistence {
	private localConfigPath: string;
	private machineConfigPath: string;
	private backupDir: string;
	private readonly logger = getLogger('ConfigPersistence');

	constructor(private readonly projectRoot: string) {
		this.localConfigPath = path.join(projectRoot, '.taskgraph', 'config.json');
		this.machineConfigPath = path.join(
			projectRoot,
			TASKGRAPH_LOCAL_CONFIG_FILE
		);
		this.backupDir = path.join(projectRoot, '.taskgraph', 'backups');
	}

	/**
	 * Save configuration to file
	 */
	async saveConfig(
		config: PartialConfiguration,
		options: PersistenceOptions = {}
	): Promise<void> {
		const { createBackup = false, atomic = true } = options;

		try {
			// Create backup if requested
			if (createBackup && (await this.configExists())) {
				await this.createBackup();
			}

			// Ensure directory exists
			const configDir = path.dirname(this.localConfigPath);
			await fs.mkdir(configDir, { recursive: true });

			// Per-machine settings go to config.local.json, the rest to config.json
			const currentMachine = await this.readJson(this.machineConfigPath);
			if (currentMachine === UNREADABLE) {
				// Keep a broken config.local.json for the user to fix rather than
				// overwrite the settings in it
				await this.writeJson(this.localConfigPath, config, atomic);
				return;
			}
			const currentShared = currentMachine
				? await this.readJson(this.localConfigPath)
				: null;
			const { shared, local } = splitMachineConfig(
				config,
				currentShared === UNREADABLE ? null : currentShared,
				currentMachine,
				new ConfigLoader(this.projectRoot).getDefaultConfig()
			);

			// Local file first: if the shared write then fails, a moved setting
			// is in both files rather than in neither
			if (currentMachine || Object.keys(local).length > 0) {
				await this.writeJson(this.machineConfigPath, local, atomic);
			}
			await this.writeJson(this.localConfigPath, shared, atomic);
		} catch (error) {
			throw new TaskGraphError(
				'Failed to save configuration',
				ERROR_CODES.CONFIG_ERROR,
				{ configPath: this.localConfigPath },
				error as Error
			);
		}
	}

	/** Parse a JSON file; null when it's missing, UNREADABLE when it isn't JSON */
	private async readJson(
		filePath: string
	): Promise<object | null | typeof UNREADABLE> {
		let text: string;
		try {
			text = await fs.readFile(filePath, 'utf-8');
		} catch {
			return null;
		}
		try {
			return JSON.parse(text);
		} catch {
			return UNREADABLE;
		}
	}

	private async writeJson(
		filePath: string,
		data: unknown,
		atomic: boolean
	): Promise<void> {
		const jsonContent = JSON.stringify(data, null, 2);
		if (atomic) {
			// Atomic write: write to temp file then rename
			const tempPath = `${filePath}.tmp`;
			await fs.writeFile(tempPath, jsonContent, 'utf-8');
			await fs.rename(tempPath, filePath);
		} else {
			await fs.writeFile(filePath, jsonContent, 'utf-8');
		}
	}

	/**
	 * Create a backup of the current configuration
	 */
	private async createBackup(): Promise<string> {
		try {
			await fs.mkdir(this.backupDir, { recursive: true });

			const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
			const backupPath = path.join(this.backupDir, `config-${timestamp}.json`);

			const configContent = await fs.readFile(this.localConfigPath, 'utf-8');
			await fs.writeFile(backupPath, configContent, 'utf-8');

			// Clean old backups
			await this.cleanOldBackups();

			return backupPath;
		} catch (error) {
			this.logger.warn('Failed to create backup:', error);
			throw error;
		}
	}

	/**
	 * Clean old backup files
	 */
	private async cleanOldBackups(maxBackups = 5): Promise<void> {
		try {
			const files = await fs.readdir(this.backupDir);
			const backupFiles = files
				.filter((f) => f.startsWith('config-') && f.endsWith('.json'))
				.sort()
				.reverse();

			// Remove old backups
			const toDelete = backupFiles.slice(maxBackups);
			for (const file of toDelete) {
				await fs.unlink(path.join(this.backupDir, file));
			}
		} catch (error) {
			this.logger.warn('Failed to clean old backups:', error);
		}
	}

	/**
	 * Check if config file exists
	 */
	async configExists(): Promise<boolean> {
		try {
			await fs.access(this.localConfigPath);
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Delete configuration file
	 */
	async deleteConfig(): Promise<void> {
		try {
			await fs.unlink(this.localConfigPath);
		} catch (error: any) {
			if (error.code !== 'ENOENT') {
				throw new TaskGraphError(
					'Failed to delete configuration',
					ERROR_CODES.CONFIG_ERROR,
					{ configPath: this.localConfigPath },
					error
				);
			}
		}
	}

	/**
	 * Get list of available backups
	 */
	async getBackups(): Promise<string[]> {
		try {
			const files = await fs.readdir(this.backupDir);
			return files
				.filter((f) => f.startsWith('config-') && f.endsWith('.json'))
				.sort()
				.reverse();
		} catch {
			return [];
		}
	}

	/**
	 * Restore from a backup
	 */
	async restoreFromBackup(backupFile: string): Promise<void> {
		const backupPath = path.join(this.backupDir, backupFile);

		try {
			const backupContent = await fs.readFile(backupPath, 'utf-8');
			await fs.writeFile(this.localConfigPath, backupContent, 'utf-8');
		} catch (error) {
			throw new TaskGraphError(
				'Failed to restore from backup',
				ERROR_CODES.CONFIG_ERROR,
				{ backupPath },
				error as Error
			);
		}
	}
}
