/**
 * Guard: CLI source must use theme.muted instead of chalk.gray.
 * chalk.gray is bright black, which is nearly invisible on Solarized Dark
 * and similar themes (see theme.ts).
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const GRAY = /chalk\.gr[ae]y/;

function sourceFiles(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) return sourceFiles(path);
		const isSource = /\.(ts|js)$/.test(name) && !/\.(spec|test)\./.test(name);
		return isSource ? [path] : [];
	});
}

describe('chalk.gray usage', () => {
	it('is not used in CLI source', () => {
		const offenders = sourceFiles(SRC_ROOT).flatMap((file) =>
			readFileSync(file, 'utf8')
				.split('\n')
				.map((line, index) => ({ line: line.trim(), number: index + 1 }))
				// Comments may mention chalk.gray to explain why it is avoided
				.filter(({ line }) => !/^(\*|\/\/|\/\*)/.test(line) && GRAY.test(line))
				.map(({ number }) => `${file.replace(SRC_ROOT, 'src')}:${number}`)
		);

		expect(offenders).toEqual([]);
	});
});
