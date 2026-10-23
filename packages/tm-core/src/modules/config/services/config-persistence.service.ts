/**
 * @fileoverview Configuration Persistence Service
 * Deletes the project config file. tm-core never writes config.json: the
 * legacy writer (scripts/modules/config-file.js) saves only the keys a user
 * set, and a second writer here saved every merged default (#356).
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import {
	ERROR_CODES,
	TaskGraphError
} from '../../../common/errors/taskgraph-error.js';

/**
 * ConfigPersistence removes the project config file for `reset`
 */
export class ConfigPersistence {
	private localConfigPath: string;

	constructor(projectRoot: string) {
		this.localConfigPath = path.join(projectRoot, '.taskgraph', 'config.json');
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
}
