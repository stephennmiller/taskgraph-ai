#!/usr/bin/env node
/**
 * Smoke-test an MCP server over stdio.
 *
 * Starts the server, runs initialize and tools/list, optionally calls tools,
 * and checks that stdout carries only JSON-RPC (any other line breaks MCP
 * clients). Prints one JSON summary on stdout so two runs can be diffed, for
 * example the built server against the previous release.
 *
 *   node apps/mcp/tests/smoke/mcp-stdio.smoke.mjs [options] [-- <server command...>]
 *
 *   --tools <tier>     TASKGRAPH_TOOLS for the server (default: all)
 *   --expect <n>       fail unless the server lists exactly n tools
 *   --cwd <dir>        working directory for the server (default: current directory)
 *   --call <tool>      call a tool after listing; repeat with --args
 *   --args <json>      arguments for the preceding --call (default: {})
 *   --timeout <ms>     per-request timeout (default: 15000)
 *
 * The server command defaults to the built dist/mcp-server.js of this repo
 * (run `npm run build` first). Exit code: 0 all checks passed, 1 a check
 * failed, 2 bad usage.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const builtServer = resolve(
	dirname(fileURLToPath(import.meta.url)),
	'../../../../dist/mcp-server.js'
);

// A server may keep running after stdin closes; give late output this long
const EXIT_GRACE_MS = 1000;

function parseNumber(name, text) {
	const n = Number(text);
	if (!Number.isFinite(n) || n < 0) throw new Error(`${name} needs a number`);
	return n;
}

function parseArgs(argv) {
	const opts = {
		tools: 'all',
		expect: null,
		cwd: process.cwd(),
		calls: [],
		timeout: 15000,
		command: null
	};
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === '--') {
			opts.command = argv.slice(i + 1);
			break;
		}
		const value = () => {
			if (i + 1 >= argv.length) throw new Error(`${arg} needs a value`);
			return argv[++i];
		};
		if (arg === '--tools') opts.tools = value();
		else if (arg === '--expect') opts.expect = parseNumber(arg, value());
		else if (arg === '--cwd') opts.cwd = value();
		else if (arg === '--timeout') opts.timeout = parseNumber(arg, value());
		else if (arg === '--call') opts.calls.push({ name: value(), args: {} });
		else if (arg === '--args') {
			const last = opts.calls.at(-1);
			if (!last) throw new Error('--args must follow --call');
			last.args = JSON.parse(value());
		} else throw new Error(`Unknown option ${arg}`);
	}
	if (opts.command === null) {
		if (!existsSync(builtServer)) {
			throw new Error(`${builtServer} not found; run npm run build first`);
		}
		opts.command = ['node', builtServer];
	}
	if (opts.command.length === 0) throw new Error('Empty server command');
	return opts;
}

// Only a response (result or error, no method) can answer one of our requests
const isResponse = (m) => !('method' in m) && ('result' in m || 'error' in m);

async function run(opts) {
	const failures = [];
	const nonJsonLines = [];
	const pending = new Map();
	let stderrTail = '';
	let gone = null;

	const child = spawn(opts.command[0], opts.command.slice(1), {
		cwd: opts.cwd,
		env: { ...process.env, TASKGRAPH_TOOLS: opts.tools },
		stdio: ['pipe', 'pipe', 'pipe']
	});
	child.stdin.on('error', () => {}); // a dead server is reported by 'close'
	child.stderr.on('data', (d) => {
		stderrTail = (stderrTail + d).slice(-2000);
	});

	const closed = new Promise((done) => {
		const onGone = (reason) => {
			if (gone) return;
			gone = `${reason}${stderrTail ? `: ${stderrTail.trim()}` : ''}`;
			for (const { reject } of pending.values()) {
				reject(new Error(`server ${gone}`));
			}
			pending.clear();
			done();
		};
		child.on('error', (err) => onGone(`could not start (${err.message})`));
		child.on('close', (code, signal) =>
			onGone(`exited (code ${code ?? signal})`)
		);
	});

	createInterface({ input: child.stdout }).on('line', (line) => {
		if (!line.trim()) return;
		let message = null;
		try {
			message = JSON.parse(line);
		} catch {
			// not JSON at all; handled below
		}
		if (
			message === null ||
			typeof message !== 'object' ||
			message.jsonrpc !== '2.0'
		) {
			nonJsonLines.push(line.slice(0, 200));
			return;
		}
		if (isResponse(message)) pending.get(message.id)?.resolve(message);
	});

	let nextId = 1;
	const request = (method, params) =>
		new Promise((resolvePromise, reject) => {
			if (gone) return reject(new Error(`server ${gone}`));
			const id = nextId++;
			const timer = setTimeout(() => {
				pending.delete(id);
				reject(new Error(`${method} timed out after ${opts.timeout}ms`));
			}, opts.timeout);
			pending.set(id, {
				resolve: (message) => {
					clearTimeout(timer);
					pending.delete(id);
					resolvePromise(message);
				},
				reject: (err) => {
					clearTimeout(timer);
					reject(err);
				}
			});
			child.stdin.write(
				`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`
			);
		});

	const summary = { command: opts.command.join(' '), tools: [], calls: [] };
	try {
		const init = await request('initialize', {
			protocolVersion: '2024-11-05',
			capabilities: {},
			clientInfo: { name: 'mcp-stdio-smoke', version: '1' }
		});
		if (init.error) failures.push(`initialize failed: ${init.error.message}`);
		child.stdin.write(
			`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`
		);

		const list = await request('tools/list', {});
		summary.tools = (list.result?.tools ?? []).map((t) => t.name).sort();
		if (list.error || summary.tools.length === 0) {
			failures.push(
				`tools/list returned no tools: ${list.error?.message ?? ''}`
			);
		}
		if (opts.expect !== null && summary.tools.length !== opts.expect) {
			failures.push(
				`expected ${opts.expect} tools, got ${summary.tools.length}`
			);
		}

		for (const call of opts.calls) {
			try {
				const res = await request('tools/call', {
					name: call.name,
					arguments: call.args
				});
				summary.calls.push({
					name: call.name,
					isError: Boolean(res.error || res.result?.isError),
					content: res.result?.content ?? null,
					error: res.error ?? null
				});
			} catch (err) {
				summary.calls.push({
					name: call.name,
					isError: true,
					content: null,
					error: { message: err.message }
				});
				failures.push(`${call.name}: ${err.message}`);
			}
		}
	} catch (err) {
		failures.push(err.message);
	} finally {
		// Let the server wind down so output written after the last reply is seen
		child.stdin.end();
		const grace = setTimeout(() => child.kill(), EXIT_GRACE_MS);
		await closed;
		clearTimeout(grace);
	}

	if (nonJsonLines.length > 0) {
		failures.push(`${nonJsonLines.length} non-JSON-RPC line(s) on stdout`);
	}
	return { ...summary, nonJsonLines, failures };
}

let opts;
try {
	opts = parseArgs(process.argv.slice(2));
} catch (err) {
	console.error(err.message);
	process.exit(2);
}

const result = await run(opts);
console.log(JSON.stringify(result, null, 2));
for (const failure of result.failures) console.error(`FAIL: ${failure}`);
process.exit(result.failures.length > 0 ? 1 : 0);
