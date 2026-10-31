/**
 * @fileoverview Print a `--json` payload with its schema version
 * Every JSON payload the CLI prints goes through here, so each one carries the
 * top-level `schemaVersion` from @tm/core.
 */

import { stringifyJson, toVersionedJson, writeJson } from '@tm/core';
import { Option } from 'commander';

/** The payload as printed: versioned, indented unless `compact` */
export function formatJson(
	payload: object,
	options: { compact?: boolean } = {}
): string {
	// Not JSON.stringify, which overflows the stack on a deep dependency tree
	return stringifyJson(toVersionedJson(payload), {
		indent: options.compact ? undefined : 2
	});
}

/** Text past which printJson prints what it has so far */
const PRINT_AT = 1 << 24;

/**
 * Print a versioned JSON payload to stdout. Indented, a long dependency chain
 * makes more text than fits in one string, so past PRINT_AT characters the
 * lines made so far are printed as they're made.
 */
export function printJson(
	payload: object,
	options: { compact?: boolean } = {}
): void {
	let text = '';
	let printAt = PRINT_AT;
	writeJson(
		toVersionedJson(payload),
		{ indent: options.compact ? undefined : 2 },
		(chunk) => {
			text += chunk;
			if (text.length < printAt) return;
			// console.log, not stdout.write: it ignores EPIPE (`| head`)
			const end = text.lastIndexOf('\n');
			if (end >= 0) {
				console.log(text.slice(0, end));
				text = text.slice(end + 1);
			}
			// Compact text has no newline: look again PRINT_AT later
			printAt = text.length + PRINT_AT;
		}
	);
	console.log(text);
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

/**
 * `--json`, the shorthand for `--format json`, for a command that takes
 * `--format`. Commander sets `format` to `json` unless `--format` is also
 * given, so the command reads only `options.format`.
 */
export function jsonOption(): Option {
	return new Option(
		'--json',
		'Output in JSON format (shorthand for --format json)'
	).implies({ format: 'json' });
}
