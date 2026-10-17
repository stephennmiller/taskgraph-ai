/**
 * Tests for the MCP server key helper: TaskGraph registers itself under the
 * `taskgraph-ai` key and only recognises servers that launch that package.
 */
import {
	MCP_SERVER_KEY,
	launchesTaskGraphPackage
} from '../../src/utils/mcp-server-key.js';

describe('mcp-server-key', () => {
	test('writes the taskgraph-ai key', () => {
		expect(MCP_SERVER_KEY).toBe('taskgraph-ai');
	});

	describe('launchesTaskGraphPackage', () => {
		test('recognises a server that runs taskgraph-ai', () => {
			expect(launchesTaskGraphPackage({ args: ['-y', 'taskgraph-ai'] })).toBe(
				true
			);
		});

		test.each([
			[undefined],
			[{}],
			[{ args: 'taskgraph-ai' }],
			[{ args: ['-y', 'other-server'] }],
			[{ args: [1, null] }]
		])('rejects unrelated or malformed servers (%p)', (server) => {
			expect(launchesTaskGraphPackage(server)).toBe(false);
		});
	});
});
