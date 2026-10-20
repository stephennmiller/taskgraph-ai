/**
 * @fileoverview tasks.json schema versioning: stamp on write, tolerate on read
 */

import type { TaskMetadata } from '../../../../common/types/index.js';

/** Schema version this build writes to tasks.json (a missing value means 1). */
export const CURRENT_SCHEMA_VERSION = 1;

function isValidVersion(value: unknown): value is number {
	return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

/** Schema version recorded for a tag's data; missing or malformed is v1. */
export function getSchemaVersion(
	metadata: Pick<TaskMetadata, 'schemaVersion'> | null | undefined
): number {
	const value = metadata?.schemaVersion;
	return isValidVersion(value) ? value : 1;
}

/**
 * Metadata to write: stamped with this build's version, but never lowered
 * below the version already on disk (a newer build's fields stay labelled).
 */
export function withSchemaVersion<T extends object>(
	metadata: T,
	existing?: Pick<TaskMetadata, 'schemaVersion'> | null
): T & { schemaVersion: number } {
	const onDisk = isValidVersion(existing?.schemaVersion)
		? existing.schemaVersion
		: 0;
	return {
		...metadata,
		schemaVersion: Math.max(CURRENT_SCHEMA_VERSION, onDisk)
	};
}

// One warning per file and tag for the life of the process: the CLI builds a
// new FileStorage per command step, so per-instance state would repeat it.
const warned = new Set<string>();

/**
 * Warn (never reject) when a tag was written by a newer schema or carries a
 * malformed version. Goes to stderr, not the logger: the logger is silent by
 * default and in MCP mode, and stderr never touches the MCP stdout stream.
 */
export function warnIfUnsupportedSchema(
	metadata: Pick<TaskMetadata, 'schemaVersion'> | null | undefined,
	tag: string,
	filePath: string
): void {
	const raw = metadata?.schemaVersion;
	const malformed = raw !== undefined && !isValidVersion(raw);
	if (!malformed && getSchemaVersion(metadata) <= CURRENT_SCHEMA_VERSION)
		return;

	const key = `${filePath}::${tag}`;
	if (warned.has(key)) return;
	warned.add(key);

	const found = malformed
		? `an unrecognized schemaVersion (${JSON.stringify(raw)})`
		: `schema version ${raw}, newer than the ${CURRENT_SCHEMA_VERSION} this version understands`;
	process.stderr.write(
		`Warning: tag "${tag}" in ${filePath} has ${found}. Loading it anyway; consider upgrading taskgraph.\n`
	);
}
