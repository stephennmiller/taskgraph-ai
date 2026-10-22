import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const script = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'../smoke/mcp-stdio.smoke.mjs'
);

interface FakeServer {
	/** Printed to stdout before anything else */
	banner?: string;
	/** Never answers any request */
	silent?: boolean;
	/** Answers everything except tools/call */
	silentCalls?: boolean;
	/** Printed to stdout 300ms after the tools/list answer */
	lateLine?: string;
	/** Exits at once, writing this to stderr */
	crash?: string;
	/** Sends a request of its own with the tools/list id before answering */
	collidingRequest?: boolean;
}

// A stand-in MCP server: lists tools b and a, and answers tools/call.
const fakeServer = (o: FakeServer = {}) => `
const rl = require('readline').createInterface({ input: process.stdin });
const send = (m) => console.log(JSON.stringify(m));
${o.crash ? `process.stderr.write(${JSON.stringify(o.crash)}); process.exit(3);` : ''}
${o.banner ? `console.log(${JSON.stringify(o.banner)});` : ''}
rl.on('line', (line) => {
	const m = JSON.parse(line);
	if (m.id === undefined || ${Boolean(o.silent)}) return;
	if (m.method === 'tools/call' && ${Boolean(o.silentCalls)}) return;
	${o.collidingRequest ? "if (m.method === 'tools/list') send({ jsonrpc: '2.0', id: m.id, method: 'ping' });" : ''}
	const result =
		m.method === 'tools/list'
			? { tools: [{ name: 'b' }, { name: 'a' }] }
			: m.method === 'tools/call'
				? { content: [{ type: 'text', text: 'called ' + m.params.name }] }
				: {};
	send({ jsonrpc: '2.0', id: m.id, result });
	${o.lateLine ? `if (m.method === 'tools/list') setTimeout(() => console.log(${JSON.stringify(o.lateLine)}), 300);` : ''}
});`;

const smoke = (args: string[], server: string) =>
	spawnSync(
		process.execPath,
		[script, ...args, '--', process.execPath, '-e', server],
		{ encoding: 'utf8', timeout: 20000 }
	);

const summaryOf = (stdout: string) => JSON.parse(stdout);

describe('mcp-stdio smoke script', () => {
	it('lists the tools sorted and exits 0 for a clean server', () => {
		const res = smoke(['--expect', '2'], fakeServer());

		expect(res.status).toBe(0);
		const summary = summaryOf(res.stdout);
		expect(summary.tools).toEqual(['a', 'b']);
		expect(summary.nonJsonLines).toEqual([]);
	});

	it('records the result of a tool call', () => {
		const res = smoke(['--call', 'a', '--args', '{"x":1}'], fakeServer());

		expect(summaryOf(res.stdout).calls).toEqual([
			{
				name: 'a',
				isError: false,
				content: [{ type: 'text', text: 'called a' }],
				error: null
			}
		]);
	});

	it('fails when stdout carries a line that is not JSON-RPC', () => {
		const res = smoke([], fakeServer({ banner: 'hello from the server' }));

		expect(res.status).toBe(1);
		expect(summaryOf(res.stdout).nonJsonLines).toEqual([
			'hello from the server'
		]);
	});

	it.each(['null', '{"debug":1}', '42'])(
		'fails on the stray JSON value %s instead of crashing',
		(banner) => {
			const res = smoke([], fakeServer({ banner }));

			expect(res.status).toBe(1);
			expect(summaryOf(res.stdout).nonJsonLines).toEqual([banner]);
		}
	);

	it('catches a line written after the last response', () => {
		const res = smoke([], fakeServer({ lateLine: 'late log line' }));

		expect(res.status).toBe(1);
		expect(summaryOf(res.stdout).nonJsonLines).toEqual(['late log line']);
	});

	it('is not fooled by a server request that reuses a request id', () => {
		const res = smoke(
			['--expect', '2'],
			fakeServer({ collidingRequest: true })
		);

		expect(res.status).toBe(0);
		expect(summaryOf(res.stdout).tools).toEqual(['a', 'b']);
	});

	it('fails fast and shows stderr when the server exits at start', () => {
		const start = Date.now();
		const res = smoke(
			['--timeout', '10000'],
			fakeServer({ crash: 'boom: cannot start' })
		);

		expect(res.status).toBe(1);
		expect(Date.now() - start).toBeLessThan(5000);
		expect(res.stderr).toContain('exited');
		expect(res.stderr).toContain('boom: cannot start');
	});

	it('fails when the tool count is not the expected one', () => {
		const res = smoke(['--expect', '3'], fakeServer());

		expect(res.status).toBe(1);
		expect(res.stderr).toContain('expected 3 tools, got 2');
	});

	it('fails instead of hanging when the server never answers', () => {
		const res = smoke(['--timeout', '300'], fakeServer({ silent: true }));

		expect(res.status).toBe(1);
		expect(res.stderr).toContain('timed out');
	});

	it('records a call that times out and still runs the next one', () => {
		const res = smoke(
			['--timeout', '300', '--call', 'a', '--call', 'b'],
			fakeServer({ silentCalls: true })
		);

		const { calls } = summaryOf(res.stdout);
		expect(res.status).toBe(1);
		expect(calls.map((c: { name: string }) => c.name)).toEqual(['a', 'b']);
		expect(calls.every((c: { isError: boolean }) => c.isError)).toBe(true);
	});

	it.each([['--nope'], ['--timeout', 'abc'], ['--expect', 'abc']])(
		'exits 2 on the bad option %s',
		(...args) => {
			expect(smoke(args, fakeServer()).status).toBe(2);
		}
	);
});
