/**
 * @fileoverview The `Parity changes` CI job runs the build comparison when a
 * changed file matches a line of .github/scripts/parity-paths.txt (grep -Ef).
 * These checks keep that list matching what goes into the compared builds.
 *
 * @integration
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'../../../..'
);
const lines = fs
	.readFileSync(path.join(root, '.github/scripts/parity-paths.txt'), 'utf8')
	.replace(/\n$/, '')
	.split('\n');
// The ERE subset used here (anchors, groups, alternation, escapes) means the
// same in JavaScript
const patterns = lines.map((line) => new RegExp(line));
const runs = (file: string) => patterns.some((p) => p.test(file));

describe('parity-paths.txt', () => {
	it('has no blank line, which grep -f would match against every file', () => {
		expect(lines.filter((line) => line.trim() === '')).toEqual([]);
	});

	it('is the list the Parity changes job reads', () => {
		const ci = fs.readFileSync(
			path.join(root, '.github/workflows/ci.yml'),
			'utf8'
		);
		expect(ci).toContain('grep -Eqf .github/scripts/parity-paths.txt');
	});

	it.each([
		'scripts/dev.js',
		'mcp-server/server.js',
		'src/profiles/claude.js',
		'assets/config.json',
		'packages/tm-core/src/index.ts',
		'packages/tm-profiles/src/index.ts',
		'packages/build-config/src/tsdown.base.ts',
		'apps/cli/src/index.ts',
		'apps/mcp/src/index.ts',
		'apps/cli/tests/parity/compare-builds.mjs',
		'apps/mcp/tests/smoke/mcp-stdio.smoke.mjs',
		'.github/scripts/run-parity.sh',
		'.github/scripts/parity-paths.txt',
		'.github/workflows/ci.yml',
		'tsdown.config.ts',
		'package.json',
		'package-lock.json'
	])('runs the comparison for %s', (file) => {
		expect(fs.existsSync(path.join(root, file))).toBe(true);
		expect(runs(file)).toBe(true);
	});

	it.each([
		'README.md',
		'apps/docs/docs.json',
		'apps/cli/tests/integration/parity-paths.test.ts',
		'packages/tm-core/tests/integration/example.test.ts',
		'packages/claude-code-plugin/commands/next.md',
		'.github/workflows/release.yml',
		'tests/unit/ci/job-timeouts.test.js'
	])('skips the comparison for %s', (file) => {
		expect(runs(file)).toBe(false);
	});
});
