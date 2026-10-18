/**
 * Guard: the CLI must not reference the Hamster cloud integration (issue #16),
 * the @tm/bridge package that redirected commands to it, or the auth and brief
 * helpers that served it.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC_ROOT = dirname(fileURLToPath(import.meta.url));
const THIS_FILE = basename(fileURLToPath(import.meta.url));
const HAMSTER =
	/hamster|@tm\/bridge|AuthManager|AuthDomain|auth-guard|auth-helpers|auth-ui|brief-selection|org-selection|checkAndBlockIfAuthenticated|ensureOrgSelected|authenticateWithBrowserMFA/i;

function sourceFiles(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) return sourceFiles(path);
		// Specs may assert that Hamster text is gone, so they are not scanned
		const isSource = /\.(ts|js)$/.test(name) && !/\.spec\./.test(name);
		return isSource && name !== THIS_FILE ? [path] : [];
	});
}

describe('Hamster integration', () => {
	it('is not referenced from the CLI source', () => {
		const offenders = sourceFiles(SRC_ROOT).flatMap((file) =>
			readFileSync(file, 'utf8')
				.split('\n')
				.map((line, index) => ({ line, number: index + 1 }))
				.filter(({ line }) => HAMSTER.test(line))
				.map(({ number }) => `${file.replace(SRC_ROOT, 'src')}:${number}`)
		);

		expect(offenders).toEqual([]);
	});
});
