/**
 * Guard: tm-core, the CLI and the MCP server start git only through runGit or
 * runGitSync (common/utils/git-utils.ts), which never use a shell, refuse to
 * run the repository's fsmonitor program, disable prompts and pagers, and
 * time out. Call sites that hardened git by hand kept differing.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const ROOTS = ['packages/tm-core/src', 'apps/cli/src', 'apps/mcp/src'];

/** `execFile('git', args)` style, or `exec('git status')` through a shell */
const GIT_SPAWN =
	/\(\s*['"`]git['"`]\s*,|\b(?:exec|execSync|spawn|spawnSync|execAsync)\s*\(\s*['"`]git\s/g;

/** Files that may start git directly, each with why */
const ALLOWED: Record<string, string> = {
	'packages/tm-core/src/common/utils/git-utils.ts': 'runGit itself'
};

function sourceFiles(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) return sourceFiles(path);
		return /\.ts$/.test(name) && !/\.(spec|test)\./.test(name) ? [path] : [];
	});
}

const spawners = ROOTS.flatMap((root) => sourceFiles(join(REPO, root)))
	.map((file) => {
		const text = readFileSync(file, 'utf8');
		return {
			file: relative(REPO, file).split(sep).join('/'),
			lines: [...text.matchAll(GIT_SPAWN)].map(
				(match) => text.slice(0, match.index).split('\n').length
			)
		};
	})
	.filter(({ lines }) => lines.length > 0);

describe('git spawns', () => {
	it('go through runGit outside the allowed files', () => {
		const offenders = spawners
			.filter(({ file }) => !(file in ALLOWED))
			.flatMap(({ file, lines }) => lines.map((line) => `${file}:${line}`));

		expect(offenders).toEqual([]);
	});

	it('allow only files that still start git directly', () => {
		const spawning = new Set(spawners.map(({ file }) => file));

		expect(Object.keys(ALLOWED).filter((file) => !spawning.has(file))).toEqual(
			[]
		);
	});
});
