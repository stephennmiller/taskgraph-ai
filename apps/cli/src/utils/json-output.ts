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

/**
 * Does this command line ask for JSON output (`--json`, `--format json`,
 * `-f json`)? Such a run prints only its JSON on stdout, so the CLI skips
 * notices around the command, like the update check.
 * @param args - The arguments after the program name
 */
export function wantsJsonOutput(args: readonly string[]): boolean {
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === '--') return false;
		if (arg === '--json') return true;
		if (arg === '--format=json' || arg === '-f=json') return true;
		if ((arg === '--format' || arg === '-f') && args[i + 1] === 'json') {
			return true;
		}
	}
	return false;
}
