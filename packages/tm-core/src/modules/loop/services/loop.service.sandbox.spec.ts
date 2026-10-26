/**
 * @fileoverview `loop --sandbox` stops its sandbox on timeout or Ctrl-C:
 * signalling the docker client leaves the sandbox running (#743). Runs a
 * fake `docker` on PATH that logs its arguments.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { LoopConfig } from '../types.js';
import { LoopService } from './loop.service.js';

let dir: string;
let log: string;

const config = (): LoopConfig => ({
	prompt: 'default',
	iterations: 1,
	sleepSeconds: 0,
	progressFile: path.join(dir, 'progress.txt'),
	sandbox: true
});

/** Each docker call, one line of arguments */
const calls = () => fs.readFileSync(log, 'utf8').trim().split('\n');

beforeEach(() => {
	dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-sandbox-'));
	log = path.join(dir, 'docker.log');
	const docker = path.join(dir, 'docker');
	// Logs the first seven arguments (the prompt has newlines); `sandbox run`
	// hangs like a long Claude run, the rest exit at once
	fs.writeFileSync(
		docker,
		`#!/bin/sh\necho $1 $2 $3 $4 $5 $6 $7 >> '${log}'\n[ "$2" = run ] && exec sleep 30\nexit 0\n`,
		{ mode: 0o755 }
	);
	vi.stubEnv('PATH', `${dir}${path.delimiter}${process.env.PATH}`);
});

afterEach(() => {
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
	fs.rmSync(dir, { recursive: true, force: true });
});

it.skipIf(process.platform === 'win32')(
	'stops the sandbox it named when an iteration times out',
	async () => {
		vi.stubEnv('TASKGRAPH_LOOP_TIMEOUT_MS', '500');

		const result = await new LoopService({ projectRoot: dir }).run(config());

		expect(result.iterations[0].status).toBe('error');
		const [run, stop] = calls();
		const name = run.match(
			/^sandbox run --name (taskgraph-loop-\w+) claude -- -p$/
		)?.[1];
		expect(name).toBeDefined();
		expect(stop).toBe(`sandbox stop ${name}`);
	}
);

it.skipIf(process.platform === 'win32')(
	'stops the sandbox on Ctrl-C',
	async () => {
		const kill = process.kill.bind(process);
		// The loop re-raises the signal on itself; keep the test runner alive
		const raised = vi
			.spyOn(process, 'kill')
			.mockImplementation((pid, sig) =>
				pid === process.pid ? true : kill(pid, sig)
			);
		const run = new LoopService({ projectRoot: dir }).run(config());
		await vi.waitFor(() => expect(calls()).toHaveLength(1));

		process.emit('SIGINT', 'SIGINT');
		await run;

		expect(calls()[1]).toMatch(/^sandbox stop taskgraph-loop-\w+$/);
		expect(raised).toHaveBeenCalledWith(process.pid, 'SIGINT');
	}
);

it('gives each project its own sandbox', async () => {
	vi.stubEnv('TASKGRAPH_LOOP_TIMEOUT_MS', '200');
	const other = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-sandbox-'));
	try {
		await new LoopService({ projectRoot: dir }).run(config());
		await new LoopService({ projectRoot: other }).run(config());
	} finally {
		fs.rmSync(other, { recursive: true, force: true });
	}

	const names = calls()
		.filter((c) => c.startsWith('sandbox run'))
		.map((c) => c.split(' ')[3]);
	expect(names[0]).not.toBe(names[1]);
});
