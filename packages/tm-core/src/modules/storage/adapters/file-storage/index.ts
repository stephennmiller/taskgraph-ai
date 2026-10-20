/**
 * @fileoverview Exports for file storage components
 */

export {
	FormatHandler,
	type FileStorageData,
	type FileFormat
} from './format-handler.js';
export {
	CURRENT_SCHEMA_VERSION,
	getSchemaVersion
} from './schema-version.js';
export { FileOperations } from './file-operations.js';
export { PathResolver } from './path-resolver.js';

// Main FileStorage class - primary export
export { FileStorage as default, FileStorage } from './file-storage.js';
