/**
 * @fileoverview A --verbose loop iteration past TASKGRAPH_LOOP_TIMEOUT_MS
 * ends even when a process Claude started still holds its output open (#659),
 * and stops the processes Claude started too (#705)
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LoopService } from '../../../src/modules/loop/services/loop.service.js';

describe.skipIf(process.platform === 'win32')('loop iteration timeout', () => {
	let dir: string;

	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-loop-timeout-'));
		const bin = path.join(dir, 'bin');
		fs.mkdirSync(bin);
		// A fake claude whose background child keeps stdout open after claude is killed
		fs.writeFileSync(
			path.join(bin, 'claude'),
			`#!/bin/sh\nsleep 30 &\necho $! > "${path.join(dir, 'child.pid')}"\nsleep 30\n`,
			{ mode: 0o755 }
		);
		vi.stubEnv('PATH', `${bin}${path.delimiter}${process.env.PATH}`);
		vi.stubEnv('TASKGRAPH_LOOP_TIMEOUT_MS', '300');
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it('stops a --verbose iteration whose subprocess outlives claude', async () => {
		const service = new LoopService({ projectRoot: dir });
		const started = Date.now();

		const result = await service.run({
			prompt: 'default',
			iterations: 1,
			sleepSeconds: 0,
			progressFile: path.join(dir, 'progress.txt'),
			verbose: true
		});

		expect(Date.now() - started).toBeLessThan(10_000);
		expect(result.iterations[0].status).toBe('error');
		expect(result.iterations[0].message).toContain('TASKGRAPH_LOOP_TIMEOUT_MS');
	}, 20_000);

	// A killed process can stay a zombie until its new parent reaps it
	const isRunning = (pid: number) => {
		try {
			process.kill(pid, 0);
		} catch {
			return false;
		}
		try {
			return !/\) Z /.test(fs.readFileSync(`/proc/${pid}/stat`, 'utf8'));
		} catch {
			return true;
		}
	};

	it.each([
		['an', false],
		['a --verbose', true]
	])(
		'stops what Claude started when %s iteration times out (#705)',
		async (_, verbose) => {
			const service = new LoopService({ projectRoot: dir });

			await service.run({
				prompt: 'default',
				iterations: 1,
				sleepSeconds: 0,
				progressFile: path.join(dir, 'progress.txt'),
				verbose
			});

			const pid = Number(fs.readFileSync(path.join(dir, 'child.pid'), 'utf8'));
			const deadline = Date.now() + 5000;
			while (isRunning(pid) && Date.now() < deadline) {
				await new Promise((resolve) => setTimeout(resolve, 50));
			}
			expect(isRunning(pid)).toBe(false);
		},
		20_000
	);

	it('stops what Claude started on Ctrl-C, then lets the signal stop the loop', async () => {
		vi.stubEnv('TASKGRAPH_LOOP_TIMEOUT_MS', '60000');
		const kill = process.kill.bind(process);
		// The re-raised signal would end the test run
		const killSpy = vi
			.spyOn(process, 'kill')
			.mockImplementation((pid, sig) =>
				pid === process.pid ? true : kill(pid, sig)
			);
		const listeners = process.listenerCount('SIGINT');
		const pidFile = path.join(dir, 'child.pid');
		const run = new LoopService({ projectRoot: dir }).run({
			prompt: 'default',
			iterations: 1,
			sleepSeconds: 0,
			progressFile: path.join(dir, 'progress.txt')
		});
		while (!fs.existsSync(pidFile) || !fs.readFileSync(pidFile, 'utf8')) {
			await new Promise((resolve) => setTimeout(resolve, 50));
		}

		process.emit('SIGINT', 'SIGINT');
		await run;

		const pid = Number(fs.readFileSync(pidFile, 'utf8'));
		const deadline = Date.now() + 5000;
		while (isRunning(pid) && Date.now() < deadline) {
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
		expect(isRunning(pid)).toBe(false);
		expect(killSpy).toHaveBeenCalledWith(process.pid, 'SIGINT');
		expect(process.listenerCount('SIGINT')).toBe(listeners);
		killSpy.mockRestore();
	}, 20_000);
});
