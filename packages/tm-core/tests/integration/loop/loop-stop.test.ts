/**
 * @fileoverview A Claude Code that ignores SIGTERM is killed, with what it
 * started, once the grace period is over (#1121): in a serial loop iteration
 * (on its timeout and on a stop signal) and in a `--merge` conflict resolve
 * (on its timeout and on abort). The parallel runner's case is the abort test in
 * loop-parallel.test.ts (`deaf-sleep`).
 *
 * @integration
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveConflict } from '../../../src/modules/loop/parallel/resolve-conflict.js';
import { spawnIteration } from '../../../src/modules/loop/services/iteration-process.js';
import { isRunning } from './loop-parallel-fixture.js';

describe.skipIf(process.platform === 'win32')(
	'stopping a Claude Code that ignores SIGTERM',
	() => {
		let dir: string;
		let claude: string;
		let pids: number[] = [];

		/** Claude's pid and its child's, once both are up */
		const pidsOnceUp = async () => {
			const file = path.join(dir, 'pids');
			await vi.waitFor(
				() => expect(fs.readFileSync(file, 'utf8')).toMatch(/^\d+ \d+\n/),
				{ timeout: 10_000, interval: 20 }
			);
			pids = fs.readFileSync(file, 'utf8').trim().split(' ').map(Number);
			return pids;
		};
		const expectGone = () =>
			vi.waitFor(
				() => {
					for (const pid of pids) expect(isRunning(pid)).toBe(false);
				},
				{ timeout: 5000, interval: 20 }
			);
		const resolve = (signal?: AbortSignal) =>
			resolveConflict({
				projectRoot: dir,
				worktree: dir,
				branch: 'taskgraph/task-2',
				commit: 'abc123',
				command: claude,
				maxBudgetUsd: 1.5,
				signal,
				killGraceMs: 200
			});

		beforeEach(() => {
			dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-loop-stop-'));
			claude = path.join(dir, 'claude');
			// The fake claude and the child it starts both ignore SIGTERM
			fs.writeFileSync(
				claude,
				`#!/bin/sh\ntrap '' TERM\nsleep 30 &\necho "$$ $!" > "${path.join(dir, 'pids')}"\nwhile :; do sleep 1; done\n`,
				{ mode: 0o755 }
			);
		});

		afterEach(() => {
			vi.unstubAllEnvs();
			vi.restoreAllMocks();
			for (const pid of pids) {
				if (isRunning(pid)) process.kill(pid, 'SIGKILL');
			}
			pids = [];
			fs.rmSync(dir, { recursive: true, force: true });
		});

		it('a serial iteration that timed out', async () => {
			const onTimeout = vi.fn();
			const child = spawnIteration(
				claude,
				[],
				dir,
				300,
				onTimeout,
				undefined,
				200
			);
			const closed = new Promise((done) => child.once('close', done));
			await pidsOnceUp();

			await closed;

			expect(onTimeout).toHaveBeenCalledOnce();
			await expectGone();
		}, 20_000);

		it('a serial iteration stopped by a signal, which then stops the loop', async () => {
			const kill = process.kill.bind(process);
			// The re-raised signal would end the test run
			const killSpy = vi
				.spyOn(process, 'kill')
				.mockImplementation((pid, sig) =>
					pid === process.pid ? true : kill(pid, sig)
				);
			const listeners = process.listenerCount('SIGTERM');
			const child = spawnIteration(
				claude,
				[],
				dir,
				60_000,
				vi.fn(),
				undefined,
				200
			);
			const exited = new Promise((done) => child.once('exit', done));
			await pidsOnceUp();

			process.emit('SIGTERM', 'SIGTERM');
			// Still waiting on Claude: the loop goes only once it's gone
			expect(killSpy).not.toHaveBeenCalledWith(process.pid, 'SIGTERM');
			await exited;

			expect(killSpy).toHaveBeenCalledWith(process.pid, 'SIGTERM');
			expect(process.listenerCount('SIGTERM')).toBe(listeners);
			await expectGone();
		}, 20_000);

		it('a conflict resolve the run aborted', async () => {
			const controller = new AbortController();
			const resolving = resolve(controller.signal);
			await pidsOnceUp();

			controller.abort();

			expect(await resolving).toEqual({ ok: false, costUsd: 1.5 });
			await expectGone();
		}, 20_000);

		it('a conflict resolve past TASKGRAPH_LOOP_TIMEOUT_MS', async () => {
			vi.stubEnv('TASKGRAPH_LOOP_TIMEOUT_MS', '300');
			const resolving = resolve();
			await pidsOnceUp();

			expect(await resolving).toEqual({ ok: false, costUsd: 1.5 });
			await expectGone();
		}, 20_000);
	}
);
