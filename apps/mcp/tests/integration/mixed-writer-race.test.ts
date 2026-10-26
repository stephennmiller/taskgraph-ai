/**
 * @fileoverview MCP, CLI, and a tag switcher writing one project at once (#697).
 *
 * A long-lived MCP server adds notes to tasks 1..N while CLI processes set
 * status, add dependencies, copy and rename tags, and note the other tag.
 * Another CLI loop switches the current tag the whole time. Every change
 * has to land on the tag it was sent to.
 *
 * Needs the build (`npm run build`).
 *
 * @integration
 */

import {
	type ChildProcess,
	execFile,
	spawn,
	spawnSync
} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const run = promisify(execFile);
const repoRoot = path.resolve(__dirname, '../../../..');
const cliBin = path.join(repoRoot, 'dist', 'taskgraph.js');
const serverBin = path.join(repoRoot, 'dist', 'mcp-server.js');

/** Tasks per side. Review Scout's repro used 15, so 30 tasks on master. */
const N = 15;

interface RpcMessage {
	id?: number;
	result?: {
		isError?: boolean;
		content?: { text?: string }[];
	};
	error?: { message?: string };
}

interface SavedTask {
	id: string | number;
	status?: string;
	details?: string;
	dependencies?: (string | number)[];
}

interface SavedFile {
	[tag: string]: { tasks?: SavedTask[] } | undefined;
}

describe('MCP and CLI writers on one project', () => {
	let dir: string;
	let home: string;
	let env: NodeJS.ProcessEnv;
	let server: ChildProcess | undefined;

	const tasksFile = () => path.join(dir, '.taskgraph', 'tasks', 'tasks.json');

	beforeEach(() => {
		if (!fs.existsSync(serverBin)) {
			throw new Error(`${serverBin} not found; run npm run build first`);
		}
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-mixed-race-'));
		home = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-mixed-race-home-'));
		const {
			TASKGRAPH_PROJECT_ROOT: _projectRoot,
			TASKGRAPH_TAG: _tag,
			...rest
		} = process.env;
		env = {
			...rest,
			HOME: home,
			FORCE_COLOR: '0',
			TASKGRAPH_SKIP_AUTO_UPDATE: '1',
			TASKGRAPH_TOOLS: 'all'
		};
		const init = spawnSync(
			process.execPath,
			[cliBin, 'init', '--yes', '--no-aliases', '--no-git'],
			{ cwd: dir, env, timeout: 60000 }
		);
		expect(init.status, init.stderr?.toString()).toBe(0);
		const task = (id: number) => ({
			id,
			title: `Task ${id}`,
			description: `Task ${id}`,
			details: '',
			testStrategy: '',
			status: 'pending',
			priority: 'medium',
			dependencies: [],
			subtasks: []
		});
		const master = Array.from({ length: 2 * N }, (_, i) => task(i + 1));
		const other = Array.from({ length: N }, (_, i) => task(i + 1));
		fs.writeFileSync(
			tasksFile(),
			JSON.stringify({
				master: { tasks: master },
				other: { tasks: other },
				scratch: { tasks: [task(1)] }
			})
		);
	});

	afterEach(() => {
		server?.kill();
		fs.rmSync(dir, { recursive: true, force: true });
		fs.rmSync(home, { recursive: true, force: true });
	});

	it('keeps every change from the server, the CLI, and the tag switch', async () => {
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
				}, 60000);
				pending.set(id, (message) => {
					clearTimeout(timer);
					resolve(message);
				});
				server?.stdin?.write(
					`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`
				);
			});

		const cli = (...args: string[]): Promise<string | undefined> =>
			run(process.execPath, [cliBin, ...args], {
				cwd: dir,
				env,
				timeout: 60000
			}).then(
				() => undefined,
				(
					error: NodeJS.ErrnoException & { stdout?: string; stderr?: string }
				) => {
					const output = `${error.stdout ?? ''}${error.stderr ?? ''}`.trim();
					return `cli ${args.join(' ')}: ${output.split('\n').pop()}`;
				}
			);

		try {
			await rpc('initialize', {
				protocolVersion: '2025-06-18',
				capabilities: {},
				clientInfo: { name: 'race', version: '0' }
			});
			server.stdin?.write(
				`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`
			);

			let switching = true;
			const switcher = (async () => {
				let i = 0;
				while (switching) {
					await cli('tags', 'use', i++ % 2 ? 'master' : 'other');
				}
			})();

			const jobs: Promise<string | undefined>[] = [];
			for (let i = 1; i <= N; i++) {
				jobs.push(
					rpc('tools/call', {
						name: 'add_note',
						arguments: {
							id: String(i),
							text: `mcp-note-${i}`,
							projectRoot: dir,
							tag: 'master'
						}
					}).then((reply) => {
						if (reply.result?.isError) {
							const text = reply.result.content?.[0]?.text?.split('\n')[0];
							return `mcp ${i}: ${text}`;
						}
						if (reply.error) return `mcp ${i}: ${reply.error.message}`;
						return undefined;
					})
				);
			}
			for (let i = N + 1; i <= 2 * N; i++) {
				jobs.push(cli('set-status', String(i), 'done', '--tag', 'master'));
			}
			for (let i = 2; i <= N; i++) {
				jobs.push(
					cli('add-dependency', '-i', String(i), '-d', '1', '--tag', 'master')
				);
			}
			jobs.push(cli('tags', 'copy', 'master', 'snap'));
			jobs.push(cli('tags', 'rename', 'scratch', 'scratch2'));
			for (let i = 1; i <= 5; i++) {
				jobs.push(
					cli('note', String(i), `cli-note-on-other-${i}`, '--tag', 'other')
				);
			}

			const errors = (await Promise.all(jobs)).filter(
				(result): result is string => result !== undefined
			);
			switching = false;
			await switcher;

			const saved = JSON.parse(
				fs.readFileSync(tasksFile(), 'utf8')
			) as SavedFile;
			const master = saved.master?.tasks ?? [];
			const byId = (id: number) =>
				master.find((task) => String(task.id) === String(id));
			const lost: string[] = [];
			for (let i = 1; i <= N; i++) {
				if (!byId(i)?.details?.includes(`mcp-note-${i}`))
					lost.push(`note ${i}`);
			}
			for (let i = N + 1; i <= 2 * N; i++) {
				if (byId(i)?.status !== 'done') lost.push(`status ${i}`);
			}
			for (let i = 2; i <= N; i++) {
				const deps = (byId(i)?.dependencies ?? []).map(String);
				if (!deps.includes('1')) lost.push(`dep ${i}`);
			}
			for (let i = 1; i <= 5; i++) {
				const onOther = saved.other?.tasks?.find(
					(task) => String(task.id) === String(i)
				);
				if (!onOther?.details?.includes(`cli-note-on-other-${i}`)) {
					lost.push(`other-note ${i}`);
				}
			}
			if (!saved.snap) lost.push('tag snap');
			if (!saved.scratch2 || saved.scratch) lost.push('rename');
			for (let i = 1; i <= 5; i++) {
				if (byId(i)?.details?.includes('cli-note-on-other')) {
					lost.push(`note leaked into master ${i}`);
				}
			}

			expect({ errors, lost }).toEqual({ errors: [], lost: [] });
		} finally {
			server.kill();
			await exited;
		}
	}, 120000);
});
