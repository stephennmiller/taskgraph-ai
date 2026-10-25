/**
 * @fileoverview When a loop iteration ends the run: the completion marker
 * must be the reply's last line, and a task preset also needs no open tasks
 * ready (#648)
 */

import * as childProcess from 'node:child_process';
import * as fsPromises from 'node:fs/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LoopConfig } from '../types.js';
import { LoopService } from './loop.service.js';

vi.mock('node:child_process');
vi.mock('node:fs/promises');

const reply = (stdout: string) => ({
	stdout,
	stderr: '',
	status: 0,
	signal: null,
	pid: 123,
	output: []
});

const QUOTED =
	'Done with task 8.\n<loop-complete>ALL_DONE</loop-complete> is not applicable: more tasks may remain.\n';
const MARKER = 'All done.\n<loop-complete>ALL_DONE</loop-complete>\n';

const config: LoopConfig = {
	prompt: 'default',
	iterations: 3,
	sleepSeconds: 0,
	progressFile: '/test/progress.txt'
};

describe('LoopService completion', () => {
	const spawnSync = vi.mocked(childProcess.spawnSync);

	beforeEach(() => {
		vi.resetAllMocks();
		vi.mocked(fsPromises.mkdir).mockResolvedValue(undefined);
		vi.mocked(fsPromises.appendFile).mockResolvedValue(undefined);
	});

	describe('marker position', () => {
		const parse = (output: string) =>
			(
				new LoopService({ projectRoot: '/p' }) as unknown as {
					parseCompletion(o: string, c: number): { status: string };
				}
			).parseCompletion(output, 0);

		it('ignores a marker quoted inside a sentence', () => {
			expect(parse(QUOTED).status).toBe('success');
		});

		it('ignores a marker followed by more text', () => {
			expect(
				parse('<loop-blocked>STUCK</loop-blocked>\nActually, I fixed it.')
					.status
			).toBe('success');
		});

		it('reads the marker on the last non-empty line', () => {
			expect(
				parse(
					'Task 12 done.\n\n  <loop-complete>ALL_DONE</loop-complete>  \n\n'
				)
			).toEqual({ status: 'complete', message: 'ALL_DONE' });
		});
	});

	describe('run()', () => {
		it('keeps going when the marker is only quoted in a sentence', async () => {
			spawnSync.mockReturnValue(reply(QUOTED) as never);

			const result = await new LoopService({ projectRoot: '/p' }).run(config);

			expect(result.totalIterations).toBe(3);
			expect(result.finalStatus).toBe('max_iterations');
		});

		it('keeps going when Claude says all done but a task is ready', async () => {
			const findReadyTask = vi
				.fn()
				.mockResolvedValueOnce('9')
				.mockResolvedValue(undefined);
			const onError = vi.fn();
			spawnSync.mockReturnValue(reply(MARKER) as never);

			const result = await new LoopService({
				projectRoot: '/p',
				findReadyTask
			}).run({ ...config, callbacks: { onError } });

			expect(result.totalIterations).toBe(2);
			expect(result.finalStatus).toBe('all_complete');
			expect(result.iterations[0].status).toBe('success');
			expect(onError).toHaveBeenCalledWith(
				'Claude said all tasks are done, but task 9 is ready. Continuing.',
				'warning'
			);
		});

		it('trusts the marker when the tasks file cannot be read', async () => {
			const findReadyTask = vi.fn().mockRejectedValue(new Error('EIO'));
			spawnSync.mockReturnValue(reply(MARKER) as never);

			const result = await new LoopService({
				projectRoot: '/p',
				findReadyTask
			}).run({ ...config, callbacks: { onError: vi.fn() } });

			expect(result.finalStatus).toBe('all_complete');
		});

		it.each([
			['a preset that picks its own work', { prompt: 'linting' }],
			['a run pinned to one task', { taskId: '3' }]
		])("doesn't count tasks for %s", async (_name, overrides) => {
			const findReadyTask = vi.fn().mockResolvedValue('9');
			spawnSync.mockReturnValue(reply(MARKER) as never);

			const result = await new LoopService({
				projectRoot: '/p',
				findReadyTask
			}).run({ ...config, ...overrides });

			expect(result.finalStatus).toBe('all_complete');
			expect(findReadyTask).not.toHaveBeenCalled();
		});

		it('tells Claude where the marker must go', async () => {
			spawnSync.mockReturnValue(reply(QUOTED) as never);

			await new LoopService({ projectRoot: '/p' }).run({
				...config,
				iterations: 1
			});

			expect(spawnSync.mock.calls[0][1]?.[1]).toContain(
				'marker alone on the last line'
			);
		});
	});
});
