/**
 * The server's `instructions` reach the model at startup even when the client
 * defers tool schemas, so they must stay short and name only tools that every
 * tier registers.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
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

describe('TaskGraphMCPServer.init', () => {
	const original = process.env.TASKGRAPH_TOOLS;
	afterEach(() => {
		if (original === undefined) delete process.env.TASKGRAPH_TOOLS;
		else process.env.TASKGRAPH_TOOLS = original;
		vi.restoreAllMocks();
	});

	it('registers the core tools by default', () => {
		delete process.env.TASKGRAPH_TOOLS;
		const server = new TaskGraphMCPServer();
		const addTool = vi.spyOn(server.server, 'addTool');

		server.init();

		expect(addTool).toHaveBeenCalledTimes(coreTools.length);
	});

	it('throws on an unknown TASKGRAPH_TOOLS entry', () => {
		process.env.TASKGRAPH_TOOLS = 'standart';

		expect(() => new TaskGraphMCPServer().init()).toThrow(/"standart"/);
	});

	it('throws when a requested tool fails to register', () => {
		process.env.TASKGRAPH_TOOLS = 'get_tasks,next_task';
		const server = new TaskGraphMCPServer();
		vi.spyOn(server.server, 'addTool').mockImplementation((tool) => {
			if (tool.name === 'next_task') throw new Error('bad schema');
		});

		expect(() => server.init()).toThrow(
			'Failed to register 1 tools: next_task'
		);
	});
});
