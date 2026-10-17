/**
 * Tests for the MCP server key helper: the fork writes `taskgraph-ai` but
 * still recognises keys written by earlier task-master-ai installs.
 */
import {
	MCP_SERVER_KEY,
	LEGACY_MCP_SERVER_KEYS,
	findMcpServerKey,
	launchesTaskMasterPackage
} from '../../src/utils/mcp-server-key.js';

describe('mcp-server-key', () => {
	test('writes the taskgraph-ai key', () => {
		expect(MCP_SERVER_KEY).toBe('taskgraph-ai');
	});

	test('treats task-master-ai as a legacy key', () => {
		expect(LEGACY_MCP_SERVER_KEYS).toContain('task-master-ai');
	});

	test('finds the current key', () => {
		expect(findMcpServerKey({ 'taskgraph-ai': {}, other: {} })).toBe(
			'taskgraph-ai'
		);
	});

	test('falls back to a legacy key', () => {
		expect(findMcpServerKey({ 'task-master-ai': {} })).toBe('task-master-ai');
	});

	test('prefers the current key when both exist', () => {
		expect(findMcpServerKey({ 'task-master-ai': {}, 'taskgraph-ai': {} })).toBe(
			'taskgraph-ai'
		);
	});

	test.each([[undefined], [null], [{}], [{ other: {} }]])(
		'returns undefined when no known key is present (%p)',
		(servers) => {
			expect(findMcpServerKey(servers)).toBeUndefined();
		}
	);

	describe('launchesTaskMasterPackage', () => {
		test.each([['taskgraph-ai'], ['task-master-ai']])(
			'recognises a server that runs %s',
			(pkg) => {
				expect(launchesTaskMasterPackage({ args: ['-y', pkg] })).toBe(true);
			}
		);

		test.each([
			[undefined],
			[{}],
			[{ args: 'taskgraph-ai' }],
			[{ args: ['-y', 'other-server'] }],
			[{ args: [1, null] }]
		])('rejects unrelated or malformed servers (%p)', (server) => {
			expect(launchesTaskMasterPackage(server)).toBe(false);
		});
	});
});
