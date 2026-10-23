/**
 * @fileoverview tasks.json schema versioning: stamp on write, tolerate on read
 */

import type { TaskMetadata } from '../../../../common/types/index.js';
import { getOwnKey, setOwnKey } from '../../../../common/utils/own-key.js';

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

function isTagObject(value: unknown): value is Record<string, unknown> {
	return (
		value !== null &&
		typeof value === 'object' &&
		!Array.isArray(value) &&
		Array.isArray(getOwnKey(value as Record<string, unknown>, 'tasks'))
	);
}

// Own-key reads and writes: tag objects may come from a null-prototype
// writer, and an inherited `metadata` or `schemaVersion` is not the file's
function stampTag(tag: Record<string, unknown>): void {
	const current = getOwnKey(tag, 'metadata');
	// Leave metadata that is not a plain object alone rather than rewrite it
	if (
		current !== undefined &&
		current !== null &&
		(typeof current !== 'object' || Array.isArray(current))
	) {
		return;
	}
	const metadata = (current ?? {}) as Record<string, unknown>;
	const onDisk = getOwnKey(metadata, 'schemaVersion') as number | undefined;
	setOwnKey(
		tag,
		'metadata',
		withSchemaVersion(metadata, { schemaVersion: onDisk })
	);
}

/**
 * Stamp every tag of a whole tasks.json object with the schema version, for
 * writers that save the file in one piece. Takes the tagged format
 * (`{ <tag>: { tasks, metadata } }`) or the single-tag `{ tasks, metadata }`.
 * Keys that are not tags are left alone, so a file that holds no tasks passes
 * through unchanged. Mutates and returns `data`.
 */
export function stampTasksFileSchemaVersion<T>(data: T): T {
	if (!data || typeof data !== 'object' || Array.isArray(data)) return data;
	// Tag keys win over root `tasks`, as FormatHandler.detectFormat reads a
	// file with both as tagged (an unmigrated file a writer added a tag to)
	const tags = Object.values(data).filter(isTagObject);
	if (tags.length > 0) {
		for (const tag of tags) stampTag(tag);
	} else if (isTagObject(data)) {
		stampTag(data);
	}
	return data;
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
