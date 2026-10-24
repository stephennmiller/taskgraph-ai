import { describe, expect, it } from 'vitest';
import { MCP_SERVER_KEY, launchesTaskGraphPackage } from './mcp-server.js';

describe('launchesTaskGraphPackage', () => {
	it('registers under the taskgraph-ai key', () => {
		expect(MCP_SERVER_KEY).toBe('taskgraph-ai');
	});

	it('recognises a server that runs taskgraph-ai', () => {
		expect(launchesTaskGraphPackage({ args: ['-y', 'taskgraph-ai'] })).toBe(
			true
		);
	});

	it.each([
		[undefined],
		[null],
		[{}],
		[{ args: 'taskgraph-ai' }],
		[{ args: ['-y', 'other-server'] }],
		[{ args: [1, null] }]
	])('rejects unrelated or malformed servers (%j)', (server) => {
		expect(launchesTaskGraphPackage(server)).toBe(false);
	});
});
