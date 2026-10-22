/**
 * Make a file from a project's .taskgraph/ comparable across builds and runs:
 * strip what differs without meaning anything.
 *
 *  - timestamps become <timestamp>
 *  - the project and work directories become <project> and <work>
 *  - in JSON: metadata.schemaVersion (a newer build writes it, an older one
 *    does not) is dropped and object keys are sorted. Array order is kept.
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

function cleanJson(value, parentKey = '') {
	if (Array.isArray(value)) return value.map((v) => cleanJson(v));
	if (value && typeof value === 'object') {
		return Object.fromEntries(
			Object.keys(value)
				.filter((key) => !(parentKey === 'metadata' && key === 'schemaVersion'))
				.sort()
				.map((key) => [key, cleanJson(value[key], key)])
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

	if (name.endsWith('.json')) {
		try {
			return `${JSON.stringify(cleanJson(JSON.parse(out)), null, 2)}\n`;
		} catch {
			// not valid JSON; keep the masked text
		}
	}
	return out;
}
