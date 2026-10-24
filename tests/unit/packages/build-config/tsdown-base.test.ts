/**
 * baseConfig.deps.neverBundle decides what stays an import in dist/ instead of being
 * bundled. Rolldown also checks it against resolved file paths, and on Windows
 * those start with a drive letter (D:\...), so a pattern for bare package
 * names must not match them: if it does, the build leaves imports of our own
 * files in dist/ that do not exist there, and the CLI fails to start.
 */

import { describe, expect, it } from 'vitest';
import { baseConfig } from '../../../../packages/build-config/src/tsdown.base.js';

const patterns = baseConfig.deps?.neverBundle as RegExp[];
const isExternal = (id: string) => patterns.some((re) => re.test(id));

describe('baseConfig.deps.neverBundle', () => {
	it.each([
		'chalk',
		'commander',
		'node:fs',
		'@ai-sdk/anthropic',
		'@modelcontextprotocol/sdk/server/index.js'
	])('keeps the npm dependency %s external', (id) => {
		expect(isExternal(id)).toBe(true);
	});

	it.each([
		'./no-color.js',
		'../apps/mcp/src/server.ts',
		'/home/runner/work/taskgraph-ai/apps/cli/src/no-color.ts',
		'D:\\a\\taskgraph-ai\\taskgraph-ai\\apps\\cli\\src\\no-color.ts',
		'c:/projects/taskgraph-ai/apps/mcp/src/server.ts',
		'@tm/core',
		'date-fns',
		'date-fns/format'
	])('bundles %s', (id) => {
		expect(isExternal(id)).toBe(false);
	});
});
