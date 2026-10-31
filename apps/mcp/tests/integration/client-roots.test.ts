/**
 * @fileoverview A tool call's projectRoot must sit inside the folders the
 * client reports as its roots (#794). Drives the real TaskGraphMCPServer over
 * an in-memory transport, with a client that answers roots/list, so the roots
 * reach the tool the way FastMCP delivers them.
 *
 * @integration
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createTasksFile } from '@tm/core/testing';
import type { FastMCPSession } from 'fastmcp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskGraphMCPServer } from '../../src/server.js';

type Message = {
	id?: number | string;
	method?: string;
	result?: any;
};

/**
 * A client that speaks JSON-RPC straight to the server's transport: it
 * advertises roots, answers roots/list with `roots`, and answers any other
 * server request (ping) with an empty result
 */
async function connectClient(server: TaskGraphMCPServer, roots: string[]) {
	const pending = new Map<number, (message: Message) => void>();
	let nextId = 1;
	const transport = {
		onmessage: undefined as ((message: unknown) => void) | undefined,
		onclose: undefined as (() => void) | undefined,
		async start() {},
		async close() {
			transport.onclose?.();
		},
		async send(message: Message) {
			if (message.method && message.id !== undefined) {
				const result =
					message.method === 'roots/list'
						? {
								roots: roots.map((root) => ({ uri: pathToFileURL(root).href }))
							}
						: {};
				queueMicrotask(() =>
					transport.onmessage?.({ jsonrpc: '2.0', id: message.id, result })
				);
			} else if (message.id !== undefined && !message.method) {
				pending.get(message.id as number)?.(message);
			}
		}
	};
	const request = (method: string, params: unknown) =>
		new Promise<Message>((resolve) => {
			const id = nextId++;
			pending.set(id, resolve);
			transport.onmessage?.({ jsonrpc: '2.0', id, method, params });
		});

	const connected = server.server.connect(transport);
	// connect() sets onmessage before it waits for the handshake
	await vi.waitFor(() => expect(transport.onmessage).toBeDefined());
	await request('initialize', {
		protocolVersion: '2025-06-18',
		capabilities: { roots: { listChanged: true } },
		clientInfo: { name: 'roots-test', version: '1.0.0' }
	});
	transport.onmessage?.({
		jsonrpc: '2.0',
		method: 'notifications/initialized'
	});
	const callTool = async (name: string, args: Record<string, unknown>) =>
		(await request('tools/call', { name, arguments: args })).result as {
			isError?: boolean;
			content: Array<{ text: string }>;
		};
	// Resolves once FastMCP has fetched the roots and emitted connect
	return { connected, callTool };
}

describe('client roots bind projectRoot (#794)', () => {
	let base: string;
	let inside: string;
	let outside: string;
	let connected: Promise<FastMCPSession> | undefined;

	const makeProject = (dir: string) => {
		fs.mkdirSync(path.join(dir, '.taskgraph', 'tasks'), { recursive: true });
		fs.writeFileSync(
			path.join(dir, '.taskgraph', 'tasks', 'tasks.json'),
			JSON.stringify(createTasksFile())
		);
	};

	const start = async (roots: string[]) => {
		const client = await connectClient(new TaskGraphMCPServer().init(), roots);
		connected = client.connected;
		return client;
	};

	beforeEach(() => {
		// A value in the developer's shell would bind every call to that project
		vi.stubEnv('TASKGRAPH_PROJECT_ROOT', undefined);
		vi.stubEnv('TASKGRAPH_TOOLS', 'core');
		base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tm-roots-')));
		inside = path.join(base, 'p1');
		outside = path.join(base, 'p2');
		makeProject(inside);
		makeProject(outside);
	});

	afterEach(async () => {
		await (await connected)?.close();
		connected = undefined;
		vi.unstubAllEnvs();
		fs.rmSync(base, { recursive: true, force: true });
	});

	it('refuses a projectRoot outside the client roots', async () => {
		const client = await start([inside]);
		await client.connected;

		const reply = await client.callTool('get_tasks', { projectRoot: outside });

		expect(reply.isError).toBe(true);
		expect(reply.content[0].text).toContain('outside this session');
	});

	it('runs a call whose projectRoot is inside the client roots', async () => {
		const client = await start([inside]);
		await client.connected;

		const reply = await client.callTool('get_tasks', { projectRoot: inside });

		expect(reply.isError).toBeFalsy();
		expect(JSON.parse(reply.content[0].text).data).toBeDefined();
	});

	it('takes any projectRoot when the client reports no roots', async () => {
		const client = await start([]);
		await client.connected;

		const reply = await client.callTool('get_tasks', { projectRoot: outside });

		expect(reply.isError).toBeFalsy();
	});

	it('refuses an outside projectRoot on a call sent right after initialize', async () => {
		const client = await start([inside]);

		const reply = await client.callTool('get_tasks', { projectRoot: outside });

		expect(reply.isError).toBe(true);
		expect(reply.content[0].text).toContain('outside this session');
	});
});
