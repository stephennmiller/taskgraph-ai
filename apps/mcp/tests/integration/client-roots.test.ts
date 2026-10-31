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
 * advertises `capabilities`, answers roots/list with `roots` (or an error),
 * and answers any other server request (ping) with an empty result
 */
async function connectClient(
	server: TaskGraphMCPServer,
	roots: string[] | 'error',
	capabilities: object = { roots: { listChanged: true } }
) {
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
				const reply =
					message.method !== 'roots/list'
						? { result: {} }
						: roots === 'error'
							? { error: { code: -32603, message: 'roots unavailable' } }
							: {
									result: {
										roots: roots.map((root) => ({
											uri: pathToFileURL(root).href
										}))
									}
								};
				queueMicrotask(() =>
					transport.onmessage?.({ jsonrpc: '2.0', id: message.id, ...reply })
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
		capabilities,
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
	// The client's roots changed: the server lists them again
	const rootsChanged = () =>
		transport.onmessage?.({
			jsonrpc: '2.0',
			method: 'notifications/roots/list_changed'
		});
	// Resolves once FastMCP has fetched the roots and emitted connect
	return { connected, callTool, rootsChanged };
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

	const start = async (roots: string[] | 'error', capabilities?: object) => {
		const client = await connectClient(
			new TaskGraphMCPServer().init(),
			roots,
			capabilities
		);
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

	it('refuses an outside projectRoot when the client lists roots without listChanged', async () => {
		const client = await start([inside], { roots: {} });
		await client.connected;

		const reply = await client.callTool('get_tasks', { projectRoot: outside });

		expect(reply.isError).toBe(true);
		expect(reply.content[0].text).toContain('outside this session');
	});

	it('refuses calls when a client that has roots fails to list them', async () => {
		const client = await start('error');
		await client.connected;

		const reply = await client.callTool('get_tasks', { projectRoot: inside });

		expect(reply.isError).toBe(true);
		expect(reply.content[0].text).toContain(
			"Could not get this session's project folders"
		);
	});

	it('takes any projectRoot from a client without roots', async () => {
		const client = await start('error', {});
		await client.connected;

		const reply = await client.callTool('get_tasks', { projectRoot: outside });

		expect(reply.isError).toBeFalsy();
	});

	it('checks projectRoot against the roots the client changed to', async () => {
		const roots = [inside];
		const client = await start(roots);
		await client.connected;
		expect(
			(await client.callTool('get_tasks', { projectRoot: inside })).isError
		).toBeFalsy();

		roots.splice(0, 1, outside);
		client.rootsChanged();

		await vi.waitFor(async () => {
			const reply = await client.callTool('get_tasks', { projectRoot: inside });
			expect(reply.isError).toBe(true);
		});
	});
});
