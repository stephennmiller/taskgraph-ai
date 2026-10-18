/**
 * Guard: tasks are always stored in .taskgraph/tasks/tasks.json (issue #16), so
 * the MCP tools must not branch on a storage type, guard commands by auth state
 * or read an auth/brief context.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC_ROOT = dirname(fileURLToPath(import.meta.url));
const THIS_FILE = basename(fileURLToPath(import.meta.url));
const REMOVED =
	/storageType|StorageType|LOCAL_ONLY_COMMANDS|LocalOnlyCommand|guardCommand|\.auth\.|tmCore\??\.auth\b/;

function sourceFiles(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) return sourceFiles(path);
		// Specs may assert that the removed names are gone, so they are not scanned
		const isSource = /\.(ts|js)$/.test(name) && !/\.spec\./.test(name);
		return isSource && name !== THIS_FILE ? [path] : [];
	});
}

describe('Storage type plumbing', () => {
	it('is not referenced from the MCP source', () => {
		const offenders = sourceFiles(SRC_ROOT).flatMap((file) =>
			readFileSync(file, 'utf8')
				.split('\n')
				.map((line, index) => ({ line, number: index + 1 }))
				.filter(({ line }) => REMOVED.test(line))
				.map(({ number }) => `${file.replace(SRC_ROOT, 'src')}:${number}`)
		);

		expect(offenders).toEqual([]);
	});
});
