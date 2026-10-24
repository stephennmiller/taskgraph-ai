/**
 * @fileoverview Configuration Persistence Service
 * Deletes the project config files. tm-core never writes config.json: the
 * legacy writer (scripts/modules/config-file.js) saves only the keys a user
 * set, and a second writer here saved every merged default (#356).
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { TASKGRAPH_LOCAL_CONFIG_FILE } from '../../../common/constants/paths.js';
import {
	ERROR_CODES,
	TaskGraphError
} from '../../../common/errors/taskgraph-error.js';

/**
 * ConfigPersistence removes the project config files for `reset`
 */
export class ConfigPersistence {
	private configPaths: string[];

	constructor(projectRoot: string) {
		this.configPaths = [
			path.join(projectRoot, '.taskgraph', 'config.json'),
			// This machine's overrides (#257); reset returns to defaults, so they go too
			path.join(projectRoot, TASKGRAPH_LOCAL_CONFIG_FILE)
		];
	}

	/**
	 * Delete config.json and config.local.json
	 */
	async deleteConfig(): Promise<void> {
		for (const configPath of this.configPaths) {
			try {
				await fs.unlink(configPath);
			} catch (error: any) {
				if (error.code !== 'ENOENT') {
					throw new TaskGraphError(
						'Failed to delete configuration',
						ERROR_CODES.CONFIG_ERROR,
						{ configPath },
						error
					);
				}
			}
		}
	}
}
