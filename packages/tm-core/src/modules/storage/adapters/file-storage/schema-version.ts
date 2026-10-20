/**
 * @fileoverview tasks.json schema versioning: stamp on write, tolerate on read
 */

import { getLogger } from '../../../../common/logger/index.js';
import type { TaskMetadata } from '../../../../common/types/index.js';

const logger = getLogger('FileStorage');

/** Schema version this build writes to tasks.json (a missing value means 1). */
export const CURRENT_SCHEMA_VERSION = 1;

/** Schema version recorded for a tag's data; a missing value is v1. */
export function getSchemaVersion(
	metadata: TaskMetadata | null | undefined
): number {
	const value = metadata?.schemaVersion;
	return typeof value === 'number' && Number.isFinite(value) ? value : 1;
}

/**
 * Warns (never rejects) when a tag was written by a newer schema, once per
 * tag per instance so repeated loads stay quiet.
 */
export class SchemaVersionGuard {
	private warnedTags = new Set<string>();

	check(metadata: TaskMetadata | null, tag: string): void {
		const found = getSchemaVersion(metadata);
		if (found > CURRENT_SCHEMA_VERSION && !this.warnedTags.has(tag)) {
			this.warnedTags.add(tag);
			logger.warn(
				`Tag "${tag}" in tasks.json uses schema version ${found}, newer than the ${CURRENT_SCHEMA_VERSION} this version understands. Loading anyway; consider upgrading taskgraph.`
			);
		}
	}
}
