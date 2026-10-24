/**
 * The pre-commit file-size check (.githooks/check-file-size.mjs). Lives in the
 * root Vitest suite so CI runs it (issue #377).
 */

import {
	MAX_TOKENS,
	findOversized,
	formatError,
	isIgnored
} from '../../../.githooks/check-file-size.mjs';

const blobOf = (bytes: number) => Buffer.alloc(bytes, 'a');
const run = (files: Record<string, Buffer>) =>
	findOversized(Object.keys(files), (p: string) => files[p]).map(
		(f: { path: string }) => f.path
	);
const overLimit = () => blobOf(MAX_TOKENS * 4 + 100);

describe('check-file-size', () => {
	it('allows a file at exactly the limit and blocks one byte over', () => {
		const limit = MAX_TOKENS * 4;
		expect(run({ 'a.ts': blobOf(limit) })).toEqual([]);
		expect(run({ 'a.ts': blobOf(limit + 1) })).toEqual(['a.ts']);
	});

	it.each([
		'package-lock.json',
		'apps/x/pnpm-lock.yaml',
		'src/api.generated.ts',
		'dist/index.js',
		'CHANGELOG.md',
		'.taskgraph/tasks/tasks.json',
		'.taskgraph/archive/2025-upstream/docs/loop-prd.md',
		'images/demo.webp'
	])('ignores lockfiles, generated code and tool-managed files: %s', (p) => {
		expect(isIgnored(p)).toBe(true);
		expect(run({ [p]: overLimit() })).toEqual([]);
	});

	it.each([
		'packages/x/.taskgraph/archive/notes.md',
		'.taskgraph/archived-notes.md',
		'.taskgraph/docs/prd.md'
	])('ignores only the root .taskgraph/archive/ folder, not %s', (p) => {
		expect(isIgnored(p)).toBe(false);
		expect(run({ [p]: overLimit() })).toEqual([p]);
	});

	it('skips binary content regardless of extension', () => {
		const bin = overLimit();
		bin[10] = 0;
		expect(run({ 'data.bin': bin })).toEqual([]);
	});

	it('error message explains how to split', () => {
		const msg = formatError([{ path: 'a.ts', tokens: 9000 }]);
		expect(msg).toMatch(/a\.ts/);
		expect(msg).toMatch(/re-export/);
		expect(msg).toMatch(/--no-verify/);
	});

	it.each([
		'tests/unit/config-manager.test.js',
		'tests/integration/mcp-server/direct-functions.test.js',
		'.claude/rules/tests.md',
		'.claude/rules/new-features.md'
	])('allows the listed legacy file %s', (p) => {
		expect(isIgnored(p)).toBe(true);
		expect(run({ [p]: overLimit() })).toEqual([]);
	});

	it.each([
		'tests/unit/new-thing.test.js',
		'tests/unit/scripts/modules/task-manager/brand-new.test.js',
		'packages/tm-core/tests/unit/config-manager.test.js'
	])('still checks %s, a neighbor of a legacy file', (p) => {
		expect(isIgnored(p)).toBe(false);
		expect(run({ [p]: overLimit() })).toEqual([p]);
	});
});
