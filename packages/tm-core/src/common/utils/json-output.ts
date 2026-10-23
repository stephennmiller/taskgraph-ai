/**
 * @fileoverview Version stamp for the CLI's machine-readable output
 *
 * Every `--json` / `--format json` payload carries a top-level `schemaVersion`
 * so scripts and agents can check the shape they parse. The number is separate
 * from the tasks.json schema version (CURRENT_SCHEMA_VERSION): the file and
 * the output change for different reasons, and a bump to one should not force
 * a bump to the other.
 *
 * Compatibility promise for a given version:
 *  - keys and value types already in a payload stay as they are
 *  - new keys can be added (consumers should ignore keys they don't know)
 * Removing or renaming a key, or changing its type, raises the version.
 * The contract is documented in apps/docs/capabilities/json-output.mdx.
 */

/** Version of the shape of every JSON payload the CLI prints. */
export const JSON_OUTPUT_SCHEMA_VERSION = 2;

/** A JSON payload with its schema version stamped on. */
export type VersionedJson<T extends object> = Omit<T, 'schemaVersion'> & {
	schemaVersion: number;
};

/**
 * Stamp `schemaVersion` on a JSON payload, as its first key.
 * The payload must be an object; a bare array has no place for the version.
 */
export function toVersionedJson<T extends object>(
	payload: T
): VersionedJson<T> {
	if (Array.isArray(payload)) {
		throw new TypeError(
			'A versioned JSON payload must be an object, not an array'
		);
	}
	const versioned = {
		schemaVersion: JSON_OUTPUT_SCHEMA_VERSION,
		...payload
	} as VersionedJson<T>;
	// A payload's own schemaVersion key never overrides the output version
	versioned.schemaVersion = JSON_OUTPUT_SCHEMA_VERSION;
	return versioned;
}
