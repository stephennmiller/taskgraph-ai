/**
 * Make a file from a project's .taskgraph/ comparable across builds and runs:
 * strip what differs without meaning anything.
 *
 *  - timestamps become <timestamp>
 *  - the project and work directories become <project> and <work>
 *  - in JSON: metadata.schemaVersion (a newer build writes it, an older one
 *    does not) is dropped and object keys are sorted. Array order is kept.
 *
 * MCP replies (a name starting with `mcp-reply`) also mask what one build
 * version changes without meaning anything: the top-level `version` field, locale dates
 * such as 10/22/2026 (written by tag copy) and the Version/Name footer of a
 * plain-text error. Nothing else is masked.
 */

import fs from 'node:fs';

const TIMESTAMP =
	/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?/g;

/** A path and its symlink-resolved form (macOS tmp is under /private). */
function pathForms(dir) {
	const forms = [dir];
	try {
		const real = fs.realpathSync(dir);
		if (real !== dir) forms.unshift(real); // longer first
	} catch {
		// not on disk; use as given
	}
	return forms;
}

const LOCALE_DATE = /\b\d{1,2}\/\d{1,2}\/\d{4}\b/g;
// The footer createErrorResponse adds; \n is a real or an escaped line break
const VERSION_FOOTER = /(?:\n|\\n)Version: [^\n"\\]*(?:\n|\\n)Name: [^\n"\\]*/g;

// maskVersion applies to the top level of an MCP reply only
function cleanJson(value, parentKey = '', maskVersion = false) {
	if (Array.isArray(value)) return value.map((v) => cleanJson(v));
	if (value && typeof value === 'object') {
		return Object.fromEntries(
			Object.keys(value)
				.filter((key) => !(parentKey === 'metadata' && key === 'schemaVersion'))
				.sort()
				.map((key) => [
					key,
					maskVersion && key === 'version'
						? '<version>'
						: cleanJson(value[key], key)
				])
		);
	}
	return value;
}

/**
 * @param {string} name File name or relative path; `.json` files are parsed
 * @param {string} text File content
 * @param {{projectDir: string, workDir: string}} context Directories to mask
 * @returns {string} Normalized content
 */
export function normalizeSnapshot(name, text, { projectDir, workDir }) {
	let out = text;
	for (const [dir, placeholder] of [
		[projectDir, '<project>'],
		[workDir, '<work>']
	]) {
		for (const form of pathForms(dir)) out = out.replaceAll(form, placeholder);
	}
	out = out.replace(TIMESTAMP, '<timestamp>');
	// tag copy writes "created on <locale date>" into tasks.json as well
	out = out.replace(LOCALE_DATE, '<date>');
	const mcp = name.startsWith('mcp-reply');
	if (mcp) {
		out = out.replace(VERSION_FOOTER, (m) =>
			m.startsWith('\\') ? '\\n<version footer>' : '\n<version footer>'
		);
	}

	if (name.endsWith('.json')) {
		try {
			return `${JSON.stringify(cleanJson(JSON.parse(out), '', mcp), null, 2)}\n`;
		} catch {
			// not valid JSON; keep the masked text
		}
	}
	return out;
}
