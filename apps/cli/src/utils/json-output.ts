/**
 * @fileoverview Print a `--json` payload with its schema version
 * Every JSON payload the CLI prints goes through here, so each one carries the
 * top-level `schemaVersion` from @tm/core.
 */

import { toVersionedJson } from '@tm/core';

/** The payload as printed: versioned, indented unless `compact` */
export function formatJson(
	payload: object,
	options: { compact?: boolean } = {}
): string {
	return JSON.stringify(
		toVersionedJson(payload),
		null,
		options.compact ? undefined : 2
	);
}

/** Print a versioned JSON payload to stdout */
export function printJson(
	payload: object,
	options: { compact?: boolean } = {}
): void {
	console.log(formatJson(payload, options));
}
