/**
 * @fileoverview When failing iterations end the run: a per-iteration
 * timeout, three errors in a row, or no Claude CLI at all (#659)
 */

import * as childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import * as fsPromises from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LoopConfig } from '../types.js';
import { LoopService } from './loop.service.js';

vi.mock('node:child_process');
vi.mock('node:fs/promises');

const exit = (status: number | null) => ({ stdout: '', stderr: '', status });
const spawnError = (code: string) => ({
	...exit(null),
	error: Object.assign(new Error(`spawnSync claude ${code}`), { code })
});

const config = (fields: Partial<LoopConfig> = {}): LoopConfig => ({
	prompt: 'default',
	iterations: 1,
	sleepSeconds: 0,
	progressFile: '/test/progress.txt',
	...fields
});

describe('LoopService limits', () => {
	const spawnSync = vi.mocked(childProcess.spawnSync);
	let service: LoopService;

	beforeEach(() => {
		vi.resetAllMocks();
		vi.mocked(fsPromises.mkdir).mockResolvedValue(undefined);
		vi.mocked(fsPromises.appendFile).mockResolvedValue(undefined);
		service = new LoopService({ projectRoot: '/test/project' });
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllEnvs();
	});

	it('passes a one-hour timeout to claude, or TASKGRAPH_LOOP_TIMEOUT_MS', async () => {
		spawnSync.mockReturnValue(exit(0) as never);

		await service.run(config());
		vi.stubEnv('TASKGRAPH_LOOP_TIMEOUT_MS', '1500');
		await service.run(config());

		expect(spawnSync.mock.calls[0][2]?.timeout).toBe(60 * 60 * 1000);
		expect(spawnSync.mock.calls[1][2]?.timeout).toBe(1500);
	});

	it('counts a timed-out iteration as an error and says how to allow longer', async () => {
		spawnSync.mockReturnValue(spawnError('ETIMEDOUT') as never);

		const result = await service.run(config());

		expect(result.iterations[0].status).toBe('error');
		expect(result.iterations[0].message).toContain('TASKGRAPH_LOOP_TIMEOUT_MS');
	});

	it('kills a --verbose iteration that runs past the timeout', async () => {
		vi.useFakeTimers();
		vi.stubEnv('TASKGRAPH_LOOP_TIMEOUT_MS', '1000');
		const child = Object.assign(new EventEmitter(), {
			stdout: new EventEmitter(),
			stderr: new EventEmitter(),
			killed: false,
			kill: vi.fn(() => child.emit('close', null))
		});
		vi.mocked(childProcess.spawn).mockReturnValue(child as never);

		const run = service.run(config({ verbose: true }));
		await vi.advanceTimersByTimeAsync(1000);
		const result = await run;

		expect(child.kill).toHaveBeenCalled();
		expect(result.iterations[0].status).toBe('error');
		expect(result.iterations[0].message).toContain('1 seconds');
	});

	it('stops with the last error after 3 failed iterations in a row', async () => {
		spawnSync.mockReturnValue(exit(1) as never);

		const result = await service.run(config({ iterations: 40 }));

		expect(spawnSync).toHaveBeenCalledTimes(3);
		expect(result.finalStatus).toBe('error');
		expect(result.errorMessage).toBe('Exit code 1');
	});

	it('keeps going when a success breaks the run of errors', async () => {
		for (const status of [1, 1, 0, 1, 1]) {
			spawnSync.mockReturnValueOnce(exit(status) as never);
		}

		const result = await service.run(config({ iterations: 5 }));

		expect(result.totalIterations).toBe(5);
		expect(result.finalStatus).toBe('max_iterations');
	});

	it('stops at once when the Claude CLI is not installed', async () => {
		spawnSync.mockReturnValue(spawnError('ENOENT') as never);

		const result = await service.run(
			config({ iterations: 40, sleepSeconds: 5 })
		);

		expect(spawnSync).toHaveBeenCalledTimes(1);
		expect(result.finalStatus).toBe('error');
		expect(result.errorMessage).toContain('Claude CLI is not installed');
	});
});
