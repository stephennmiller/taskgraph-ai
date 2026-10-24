/**
 * baseConfig.external decides what stays an import in dist/ instead of being
 * bundled. Rolldown also checks it against resolved file paths, and on Windows
 * those start with a drive letter (D:\...), so a pattern for bare package
 * names must not match them: if it does, the build leaves imports of our own
 * files in dist/ that do not exist there, and the CLI fails to start.
 */

import { describe, expect, it } from 'vitest';
import { baseConfig } from '../../../../packages/build-config/src/tsdown.base.js';

const patterns = baseConfig.external as RegExp[];
const isExternal = (id: string) => patterns.some((re) => re.test(id));

describe('baseConfig.external', () => {
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
		'./modules/no-color.js',
		'../mcp-server/src/index.js',
		'/home/runner/work/taskgraph-ai/scripts/modules/no-color.js',
		'D:\\a\\taskgraph-ai\\taskgraph-ai\\scripts\\modules\\no-color.js',
		'c:/projects/taskgraph-ai/mcp-server/src/index.js',
		'@tm/core'
	])('bundles our own module %s', (id) => {
		expect(isExternal(id)).toBe(false);
	});
});
