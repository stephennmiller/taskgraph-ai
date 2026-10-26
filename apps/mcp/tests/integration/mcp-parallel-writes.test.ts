/**
 * @fileoverview One MCP server, many add_note calls at once (#697).
 *
 * Each tool call builds its own tm-core and writes tasks.json. Those writes
 * used to take the file lock together, and the lock gives up after about
 * 2.5s, so some calls failed. Every note has to land.
 *
 * Needs the build (`npm run build`).
 *
 * @integration
 */

import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../..');
const cliBin = path.join(repoRoot, 'dist', 'taskgraph.js');
const serverBin = path.join(repoRoot, 'dist', 'mcp-server.js');

/** How many add_note calls run at once. Review Scout's repro used 15. */
const K = 15;

interface RpcMessage {
	id?: number;
	result?: {
		isError?: boolean;
		content?: { text?: string }[];
	};
	error?: { message?: string };
}

describe('one MCP server, concurrent add_note', () => {
	let dir: string;
	let home: string;
	let env: NodeJS.ProcessEnv;
	let server: ChildProcess | undefined;

	const tasksFile = () => path.join(dir, '.taskgraph', 'tasks', 'tasks.json');

	beforeEach(() => {
		if (!fs.existsSync(serverBin)) {
			throw new Error(`${serverBin} not found; run npm run build first`);
		}
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-mcp-parallel-'));
		home = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-mcp-parallel-home-'));
		const {
			TASKGRAPH_PROJECT_ROOT: _projectRoot,
			TASKGRAPH_TAG: _tag,
			...rest
		} = process.env;
		env = {
			...rest,
			HOME: home,
			FORCE_COLOR: '0',
			TASKGRAPH_SKIP_AUTO_UPDATE: '1'
		};
		const init = spawnSync(
			process.execPath,
			[cliBin, 'init', '--yes', '--no-aliases', '--no-git'],
			{ cwd: dir, env, timeout: 60000 }
		);
		expect(init.status, init.stderr?.toString()).toBe(0);
		const tasks = Array.from({ length: K }, (_, i) => ({
			id: i + 1,
			title: `Task ${i + 1}`,
			description: `Task ${i + 1}`,
			details: '',
			testStrategy: '',
			status: 'pending',
			priority: 'medium',
			dependencies: [],
			subtasks: []
		}));
		fs.writeFileSync(tasksFile(), JSON.stringify({ master: { tasks } }));
	});

	afterEach(() => {
		server?.kill();
		fs.rmSync(dir, { recursive: true, force: true });
		fs.rmSync(home, { recursive: true, force: true });
	});

	it('keeps every note when the calls share one server', async () => {
		server = spawn(process.execPath, [serverBin], {
			cwd: dir,
			env,
			stdio: ['pipe', 'pipe', 'pipe']
		});
		let stderr = '';
		server.stderr?.on('data', (chunk) => {
			stderr += chunk;
		});
		const pending = new Map<number, (message: RpcMessage) => void>();
		let nextId = 1;
		createInterface({ input: server.stdout! }).on('line', (line) => {
			try {
				const message = JSON.parse(line) as RpcMessage;
				if (message.id === undefined) return;
				pending.get(message.id)?.(message);
				pending.delete(message.id);
			} catch {
				// A non-JSON line on stdout is a server bug; the call times out
			}
		});
		const exited = new Promise<void>((resolve) => {
			server?.on('close', () => {
				for (const [id, settle] of pending) {
					pending.delete(id);
					settle({
						error: { message: `server exited\n${stderr}`.trim() }
					});
				}
				resolve();
			});
		});

		const rpc = (method: string, params: unknown) =>
			new Promise<RpcMessage>((resolve, reject) => {
				const id = nextId++;
				const timer = setTimeout(() => {
					pending.delete(id);
					reject(new Error(`no reply to ${method} (${id})`));
				}, 30000);
				pending.set(id, (message) => {
					clearTimeout(timer);
					resolve(message);
				});
				server?.stdin?.write(
					`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`
				);
			});

		try {
			await rpc('initialize', {
				protocolVersion: '2025-06-18',
				capabilities: {},
				clientInfo: { name: 'p', version: '0' }
			});
			server.stdin?.write(
				`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`
			);

			const replies = await Promise.all(
				Array.from({ length: K }, (_, i) =>
					rpc('tools/call', {
						name: 'add_note',
						arguments: {
							id: String(i + 1),
							text: `n${i + 1}`,
							projectRoot: dir
						}
					})
				)
			);
			const errors = replies
				.map((reply) => {
					if (reply.error) return reply.error.message ?? 'rpc error';
					if (reply.result?.isError) {
						return (
							reply.result.content?.[0]?.text?.split('\n')[0] ?? 'tool error'
						);
					}
					return undefined;
				})
				.filter((error): error is string => error !== undefined);

			const saved = JSON.parse(fs.readFileSync(tasksFile(), 'utf8'));
			const tasks = saved.master.tasks as {
				id: string | number;
				details?: string;
			}[];
			const missing = Array.from({ length: K }, (_, index) => index + 1).filter(
				(id) => {
					const task = tasks.find((item) => String(item.id) === String(id));
					// \b so n1 does not match a note that only says n10
					return !new RegExp(`\\bn${id}\\b`).test(task?.details ?? '');
				}
			);
			// The server logs its startup on stderr; that is not a failed call
			expect(errors, stderr).toEqual([]);
			expect(missing).toEqual([]);
		} finally {
			server.kill();
			await exited;
		}
	}, 60000);
});
