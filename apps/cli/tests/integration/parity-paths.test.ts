/**
 * @fileoverview The `Parity changes` CI job runs the build comparison when a
 * changed file matches a line of .github/scripts/parity-paths.txt (grep -zEf).
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
		expect(ci).toContain('grep -zEqf .github/scripts/parity-paths.txt');
	});

	it.each([
		'scripts/dev.js',
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
		'packages/tm-core/package.json',
		'apps/mcp/package.json',
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
		'.github/workflows/version-bump.yml',
		'packages/claude-code-plugin/package.json',
		'tests/unit/ci/job-timeouts.test.js'
	])('skips the comparison for %s', (file) => {
		expect(runs(file)).toBe(false);
	});
});

// `code` output of the same job: parity-paths.txt plus test-paths.txt decide
// whether the workspace suites, Smoke, Startup Time and Packed tarball run
describe('test-paths.txt', () => {
	const extra = fs
		.readFileSync(path.join(root, '.github/scripts/test-paths.txt'), 'utf8')
		.replace(/\n$/, '')
		.split('\n');
	const all = [...patterns, ...extra.map((line) => new RegExp(line))];
	const tests = (file: string) => all.some((p) => p.test(file));

	it('has no blank line, which grep -f would match against every file', () => {
		expect(extra.filter((line) => line.trim() === '')).toEqual([]);
	});

	it('is the list the Parity changes job reads', () => {
		const ci = fs.readFileSync(
			path.join(root, '.github/workflows/ci.yml'),
			'utf8'
		);
		expect(ci).toContain(
			'-f .github/scripts/parity-paths.txt -f .github/scripts/test-paths.txt'
		);
	});

	it.each([
		'apps/cli/tests/integration/parity-paths.test.ts',
		'apps/mcp/vitest.config.ts',
		'packages/tm-core/tests/fixtures/taskmaster-project',
		'packages/tm-profiles/package.json',
		'.github/scripts/pack-smoke.sh',
		'.github/scripts/check-startup-time.mjs',
		'.mcp.json',
		'turbo.json',
		'tsconfig.json',
		'vitest.config.ts',
		'.nvmrc',
		'README.md',
		'CHANGELOG.md',
		'LICENSE'
	])('runs the suites for %s', (file) => {
		expect(fs.existsSync(path.join(root, file))).toBe(true);
		expect(tests(file)).toBe(true);
	});

	it.each([
		'CONTRIBUTING.md',
		'apps/docs/docs.json',
		'.github/workflows/version-bump.yml',
		'.taskgraph/tasks/tasks.json',
		'packages/claude-code-plugin/commands/next.md',
		'tests/unit/ci/job-timeouts.test.js',
		'evals/baseline.json'
	])('skips the suites for %s', (file) => {
		expect(tests(file)).toBe(false);
	});
});
