import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	MAX_TOKENS,
	findOversized,
	formatError,
	isIgnored
} from './check-file-size.mjs';

const blobOf = (bytes) => Buffer.alloc(bytes, 'a');
const run = (files) =>
	findOversized(Object.keys(files), (p) => files[p]).map((f) => f.path);

test('allows a file at exactly the limit and blocks one byte over', () => {
	const limit = MAX_TOKENS * 4;
	assert.deepEqual(run({ 'a.ts': blobOf(limit) }), []);
	assert.deepEqual(run({ 'a.ts': blobOf(limit + 1) }), ['a.ts']);
});

test('ignores lockfiles, generated code, and tool-managed files', () => {
	const big = blobOf(MAX_TOKENS * 4 + 100);
	for (const p of [
		'package-lock.json',
		'apps/x/pnpm-lock.yaml',
		'src/api.generated.ts',
		'dist/index.js',
		'CHANGELOG.md',
		'.taskgraph/tasks/tasks.json',
		'images/demo.webp'
	]) {
		assert.ok(isIgnored(p), p);
		assert.deepEqual(run({ [p]: big }), []);
	}
});

test('skips binary content regardless of extension', () => {
	const bin = blobOf(MAX_TOKENS * 4 + 100);
	bin[10] = 0;
	assert.deepEqual(run({ 'data.bin': bin }), []);
});

test('error message explains how to split', () => {
	const msg = formatError([{ path: 'a.ts', tokens: 9000 }]);
	assert.match(msg, /a\.ts/);
	assert.match(msg, /re-export/);
	assert.match(msg, /--no-verify/);
});

test('allows the listed legacy test files but still checks their neighbors', () => {
	const big = blobOf(MAX_TOKENS * 4 + 100);
	for (const p of [
		'tests/unit/config-manager.test.js',
		'tests/unit/scripts/modules/task-manager/parse-prd.test.js',
		'tests/integration/mcp-server/direct-functions.test.js',
		'.claude/rules/tests.md',
		'.claude/rules/new-features.md'
	]) {
		assert.ok(isIgnored(p), p);
		assert.deepEqual(run({ [p]: big }), []);
	}
	for (const p of [
		'tests/unit/new-thing.test.js',
		'tests/unit/scripts/modules/task-manager/brand-new.test.js',
		'packages/tm-core/tests/unit/config-manager.test.js'
	]) {
		assert.ok(!isIgnored(p), p);
		assert.deepEqual(run({ [p]: big }), [p]);
	}
});
