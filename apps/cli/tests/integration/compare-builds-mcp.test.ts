/**
 * @fileoverview Tests for the `mcp` step of the build comparison (tests/parity):
 * it calls an MCP tool on each build's server and compares the replies. The
 * servers here are stand-ins; the end-to-end cases need the build
 * (`npm run build`) for the CLI's `init` and skip without it.
 *
 * @integration
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getCliBinPath } from '../helpers/test-utils.js';
import { deriveServerCommand, runScenario } from '../parity/compare-builds.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const compareScript = path.resolve(here, '../parity/compare-builds.mjs');
const fixture = path.resolve(here, '../parity/fixtures/tasks-tagged.json');
const cli = getCliBinPath();
const built = fs.existsSync(cli);

describe('deriveServerCommand', () => {
	it.each([
		['node /repo/dist/taskgraph.js', 'node /repo/dist/mcp-server.js'],
		['node "/repo/dist/taskgraph.js"', 'node "/repo/dist/mcp-server.js"'],
		[
			'npx -y -p taskgraph-ai@0.54.14 taskgraph',
			'npx -y -p taskgraph-ai@0.54.14 taskgraph-mcp'
		],
		['/opt/bin/taskgraph', '/opt/bin/taskgraph-mcp']
	])('turns %s into %s', (build, server) => {
		expect(deriveServerCommand(build)).toBe(server);
	});

	it.each(['node /repo/cli.js', 'taskgraph-ai', 'mytaskgraph'])(
		'gives up on %s',
		(build) => {
			expect(deriveServerCommand(build)).toBeNull();
		}
	);
});

describe.skipIf(!built)('mcp steps', () => {
	let work: string;

	beforeEach(() => {
		work = fs.mkdtempSync(path.join(os.tmpdir(), 'compare-mcp-'));
	});

	afterEach(() => {
		fs.rmSync(work, { recursive: true, force: true });
	});

	interface Fake {
		/** Extra fields in the JSON reply */
		extra?: object;
		/** Plain text instead of the JSON reply */
		text?: string;
		isError?: boolean;
		/** Answer tools/call with a JSON-RPC error (no content) */
		rpcError?: boolean;
		schema?: object;
	}

	/**
	 * A stand-in build: `taskgraph` runs the real CLI, `taskgraph-mcp` is a
	 * stand-in MCP server that echoes what it was given. The build string ends in
	 * `taskgraph`, so the server command is derived from it.
	 */
	const makeBuild = (name: string, fake: Fake = {}) => {
		const dir = path.join(work, name);
		fs.mkdirSync(dir);
		fs.writeFileSync(
			path.join(dir, 'server.js'),
			`
const fs = require('fs');
const cfg = ${JSON.stringify(fake)};
const same = (a, b) => { try { return fs.realpathSync(a) === fs.realpathSync(b); } catch { return false; } };
const send = (m) => console.log(JSON.stringify(m));
require('readline').createInterface({ input: process.stdin }).on('line', (line) => {
	const m = JSON.parse(line);
	if (m.id === undefined) return;
	if (m.method === 'tools/list') {
		return send({ jsonrpc: '2.0', id: m.id, result: { tools: [{ name: 'get_tasks', inputSchema: cfg.schema ?? { type: 'object' } }] } });
	}
	if (m.method !== 'tools/call') return send({ jsonrpc: '2.0', id: m.id, result: {} });
	if (cfg.rpcError) return send({ jsonrpc: '2.0', id: m.id, error: { code: -32602, message: 'bad params in ' + process.cwd() } });
	const body = {
		tool: m.params.name,
		input: m.params.arguments,
		rootIsProject: same(String(m.params.arguments.projectRoot), process.cwd()),
		envRoot: process.env.TASKGRAPH_PROJECT_ROOT ?? null,
		...cfg.extra
	};
	send({ jsonrpc: '2.0', id: m.id, result: { isError: Boolean(cfg.isError), content: [{ type: 'text', text: cfg.text ?? JSON.stringify(body) }] } });
});`
		);
		fs.writeFileSync(
			path.join(dir, 'taskgraph'),
			`#!/bin/sh\nexec node "${cli}" "$@"\n`,
			{ mode: 0o755 }
		);
		fs.writeFileSync(
			path.join(dir, 'taskgraph-mcp'),
			`#!/bin/sh\nexec node "${path.join(dir, 'server.js')}"\n`,
			{ mode: 0o755 }
		);
		return path.join(dir, 'taskgraph');
	};

	const step = { mcp: 'get_tasks', input: { projectRoot: '<project>' } };

	const scenarioFile = (steps: unknown[]) => {
		const file = path.join(work, 'scenario.json');
		fs.writeFileSync(file, JSON.stringify({ fixture, steps }));
		return file;
	};

	const compare = (a: string, b: string, steps: unknown[]) =>
		spawnSync(
			process.execPath,
			[compareScript, '--a', a, '--b', b, '--scenario', scenarioFile(steps)],
			{
				encoding: 'utf8',
				timeout: 120000,
				env: { ...process.env, TASKGRAPH_SKIP_AUTO_UPDATE: '1' }
			}
		);

	it('finds no differences between identical servers', () => {
		const res = compare(makeBuild('a'), makeBuild('b'), [step]);

		expect(res.status, res.stdout + res.stderr).toBe(0);
		expect(res.stdout).toContain('No differences');
	});

	it('reports a reply field that differs, with the step number', () => {
		const a = makeBuild('a', { extra: { total: 3 } });
		const b = makeBuild('b', { extra: { total: 4 } });

		const res = compare(a, b, [['list'], step]);

		expect(res.status).toBe(1);
		expect(res.stdout).toContain('Step 2: mcp get_tasks');
		expect(res.stdout).toContain('mcp:2');
		expect(res.stdout).toContain('-  "total": 3');
		expect(res.stdout).toContain('+  "total": 4');
	});

	it('reports a changed parameter in the tool list', () => {
		const a = makeBuild('a', { schema: { properties: { projectRoot: {} } } });
		const b = makeBuild('b', { schema: { properties: { root: {} } } });

		const res = compare(a, b, [step]);

		expect(res.status).toBe(1);
		expect(res.stdout).toContain('mcp:tools');
		expect(res.stdout).toContain('projectRoot');
	});

	it('replaces <project> in the input with the temp project', () => {
		const run = runScenario(makeBuild('a'), { fixture, steps: [step] });

		const reply = JSON.parse(run.steps[1].files['mcp:1']);
		expect(reply.rootIsProject).toBe(true);
		expect(run.steps[1].status).toBe(0);
	});

	it('does not report a version that differs between the servers', () => {
		const a = makeBuild('a', { extra: { version: { version: '1.0.0' } } });
		const b = makeBuild('b', { extra: { version: { version: '2.0.0' } } });

		const res = compare(a, b, [step]);

		expect(res.status, res.stdout + res.stderr).toBe(0);
	});

	it('counts an error reply as unexpected unless the step expects it', () => {
		const a = makeBuild('a', { isError: true, text: 'Error: nope' });
		const b = makeBuild('b', { isError: true, text: 'Error: nope' });

		const bad = compare(a, b, [step]);
		const ok = compare(a, b, [{ ...step, expectError: true }]);

		expect(bad.status).toBe(1);
		expect(bad.stdout).toContain('did not exit as expected');
		expect(ok.status, ok.stdout + ok.stderr).toBe(0);
	});

	it('records a reply without content instead of crashing', () => {
		const build = makeBuild('a', { rpcError: true });

		const run = runScenario(build, { fixture, steps: [step] });

		const reply = JSON.parse(run.steps[1].files['mcp:1']);
		expect(reply.content).toBeNull();
		expect(reply.error.message).toContain('bad params');
		expect(reply.error.message).toContain('<project>');
		expect(run.steps[1].status).toBe(1);
	});

	it('exits 2 when a build has an mcp step and no derivable server', () => {
		const res = compare('node /somewhere/cli.js', makeBuild('b'), [step]);

		expect(res.status).toBe(2);
		expect(res.stderr).toContain('MCP server');
		expect(res.stderr).toContain('node /somewhere/cli.js');
	});

	it('does not pass TASKGRAPH_PROJECT_ROOT of the parent to the server', () => {
		const build = makeBuild('a');
		process.env.TASKGRAPH_PROJECT_ROOT = '/not/the/project';
		try {
			const run = runScenario(build, { fixture, steps: [step] });

			expect(JSON.parse(run.steps[1].files['mcp:1']).envRoot).toBeNull();
		} finally {
			delete process.env.TASKGRAPH_PROJECT_ROOT;
		}
	});
});
