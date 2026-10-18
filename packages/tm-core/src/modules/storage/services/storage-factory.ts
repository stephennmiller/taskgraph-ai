/**
 * @fileoverview Storage factory for creating the storage implementation
 */

import type { RuntimeStorageConfig } from '../../../common/interfaces/configuration.interface.js';
import type { IStorage } from '../../../common/interfaces/storage.interface.js';
import { FileStorage } from '../adapters/file-storage/index.js';

/**
 * Factory for creating the storage implementation
 */
export class StorageFactory {
	/**
	 * Create the storage implementation from runtime storage config
	 * Tasks are always stored in a local file, so this returns file storage.
	 * @param storageConfig - Runtime storage configuration
	 * @param projectPath - Project root path (used when no base path is configured)
	 * @returns Storage implementation
	 */
	static async createFromStorageConfig(
		storageConfig: RuntimeStorageConfig,
		projectPath: string
	): Promise<IStorage> {
		return new FileStorage(storageConfig.basePath || projectPath);
	}
}
