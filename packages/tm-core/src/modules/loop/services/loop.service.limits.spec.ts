/**
 * @fileoverview When failing iterations end the run: a per-iteration
 * timeout, three errors in a row, or no Claude CLI at all (#659)
 */

import * as childProcess from 'node:child_process';
import * as fsPromises from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LoopConfig } from '../types.js';
import { fakeClaude } from './fake-claude.js';
import { LoopService } from './loop.service.js';

vi.mock('node:child_process');
vi.mock('node:fs/promises');

const exit = (status: number | null) => () => fakeClaude({ status }) as never;
const spawnError = (code: string) => () =>
	fakeClaude({
		error: Object.assign(new Error(`spawn claude ${code}`), { code })
	}) as never;

const config = (fields: Partial<LoopConfig> = {}): LoopConfig => ({
	prompt: 'default',
	iterations: 1,
	sleepSeconds: 0,
	progressFile: '/test/progress.txt',
	...fields
});

describe('LoopService limits', () => {
	const spawn = vi.mocked(childProcess.spawn);
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

	it.each([
		['an', false],
		['a --verbose', true]
	])(
		'stops %s iteration that runs past TASKGRAPH_LOOP_TIMEOUT_MS and says how to allow longer',
		async (_, verbose) => {
			vi.useFakeTimers();
			vi.stubEnv('TASKGRAPH_LOOP_TIMEOUT_MS', '1000');
			const child = fakeClaude({ hang: true });
			spawn.mockReturnValue(child as never);

			const run = service.run(config({ verbose }));
			await vi.advanceTimersByTimeAsync(999);
			expect(child.kill).not.toHaveBeenCalled();
			await vi.advanceTimersByTimeAsync(1);
			const result = await run;

			expect(child.kill).toHaveBeenCalledWith('SIGTERM');
			expect(result.iterations[0].status).toBe('error');
			expect(result.iterations[0].message).toContain('1 seconds');
			expect(result.iterations[0].message).toContain(
				'TASKGRAPH_LOOP_TIMEOUT_MS'
			);
		}
	);

	it('waits an hour by default', async () => {
		vi.useFakeTimers();
		const child = fakeClaude({ hang: true });
		spawn.mockReturnValue(child as never);

		const run = service.run(config());
		await vi.advanceTimersByTimeAsync(60 * 60 * 1000 - 1);
		expect(child.kill).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		await run;

		expect(child.kill).toHaveBeenCalled();
	});

	it.skipIf(process.platform === 'win32')(
		'starts claude in its own process group, so a timeout reaches what it started (#705)',
		async () => {
			spawn.mockImplementation(exit(0));

			await service.run(config());
			await service.run(config({ verbose: true }));

			expect(spawn.mock.calls[0][2]?.detached).toBe(true);
			expect(spawn.mock.calls[1][2]?.detached).toBe(true);
		}
	);

	it('stops with the last error after 3 failed iterations in a row', async () => {
		spawn.mockImplementation(exit(1));

		const result = await service.run(config({ iterations: 40 }));

		expect(spawn).toHaveBeenCalledTimes(3);
		expect(result.finalStatus).toBe('error');
		expect(result.errorMessage).toBe('Exit code 1');
	});

	it('keeps going when a success breaks the run of errors', async () => {
		for (const status of [1, 1, 0, 1, 1]) {
			spawn.mockImplementationOnce(exit(status));
		}

		const result = await service.run(config({ iterations: 5 }));

		expect(result.totalIterations).toBe(5);
		expect(result.finalStatus).toBe('max_iterations');
	});

	it('stops at once when the Claude CLI is not installed', async () => {
		spawn.mockImplementation(spawnError('ENOENT'));

		const result = await service.run(
			config({ iterations: 40, sleepSeconds: 5 })
		);

		expect(spawn).toHaveBeenCalledTimes(1);
		expect(result.finalStatus).toBe('error');
		expect(result.errorMessage).toContain('Claude CLI is not installed');
	});
});
