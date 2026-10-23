/**
 * @fileoverview Exports for file storage components
 */

export {
	CURRENT_SCHEMA_VERSION,
	getSchemaVersion,
	stampTasksFileSchemaVersion,
	withSchemaVersion
} from './schema-version.js';

// Main FileStorage class - primary export
export { FileStorage } from './file-storage.js';
