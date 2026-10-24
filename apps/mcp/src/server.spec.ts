/**
 * The server's `instructions` reach the model at startup even when the client
 * defers tool schemas, so they must stay short and name only tools that every
 * tier registers.
 */

import { describe, expect, it } from 'vitest';
import { SERVER_INSTRUCTIONS, TaskGraphMCPServer } from './server.js';
import { coreTools } from './tools/tool-registry.js';

describe('MCP server instructions', () => {
	it('are three lines that point at next_task and set_task_status', () => {
		const lines = SERVER_INSTRUCTIONS.split('\n');

		expect(lines).toHaveLength(3);
		expect(lines[0]).toMatch(/^TaskGraph tracks/);
		expect(SERVER_INSTRUCTIONS).toContain('next_task');
		expect(SERVER_INSTRUCTIONS).toContain('set_task_status');
	});

	it('name only core tools', () => {
		const named = SERVER_INSTRUCTIONS.match(/\b[a-z]+(?:_[a-z]+)+\b/g) ?? [];

		expect(named.length).toBeGreaterThanOrEqual(3);
		expect(named.filter((tool) => !coreTools.includes(tool))).toEqual([]);
	});

	it('are passed to FastMCP', () => {
		const server = new TaskGraphMCPServer();

		expect(server.options.instructions).toBe(SERVER_INSTRUCTIONS);
	});
});
