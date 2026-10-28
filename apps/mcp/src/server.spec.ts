/**
 * The server's `instructions` reach the model at startup even when the client
 * defers tool schemas, so they must stay short and name only tools that every
 * tier registers.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
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

describe('loading the server module', () => {
	let dir: string | undefined;
	afterEach(() => {
		if (dir) fs.rmSync(dir, { recursive: true, force: true });
	});

	// A cloned repo's .env must not reach process.env, which the Claude Code
	// subprocess inherits
	it("leaves the working directory's .env out of process.env", () => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-mcp-env-'));
		fs.writeFileSync(path.join(dir, '.env'), 'TASKGRAPH_PROBE=1\n');
		const tsx = pathToFileURL(
			createRequire(import.meta.url).resolve('tsx/esm')
		);
		const server = pathToFileURL(
			path.join(path.dirname(fileURLToPath(import.meta.url)), 'server.ts')
		);
		const env = { ...process.env };
		delete env.TASKGRAPH_PROBE;

		const out = execFileSync(
			process.execPath,
			[
				'--import',
				tsx.href,
				'--input-type=module',
				'-e',
				`await import('${server.href}'); console.log(String(process.env.TASKGRAPH_PROBE))`
			],
			{ cwd: dir, encoding: 'utf8', env }
		);

		expect(out.trim().split('\n').at(-1)).toBe('undefined');
	}, 60000);
});
