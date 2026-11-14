/**
 * @fileoverview When a loop iteration ends the run: the completion marker
 * must be the reply's last line, and a task preset also needs no open tasks
 * ready (#648)
 */

import * as childProcess from 'node:child_process';
import * as fsPromises from 'node:fs/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LoopConfig } from '../types.js';
import { fakeClaude } from './fake-claude.js';
import { parseCompletion } from './iteration-result.js';
import { LoopService } from './loop.service.js';

vi.mock('node:child_process');
vi.mock('node:fs/promises');

const reply = (stdout: string) => () => fakeClaude({ stdout }) as never;

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
	const spawn = vi.mocked(childProcess.spawn);

	beforeEach(() => {
		vi.resetAllMocks();
		vi.mocked(fsPromises.mkdir).mockResolvedValue(undefined);
		vi.mocked(fsPromises.appendFile).mockResolvedValue(undefined);
	});

	describe('marker position', () => {
		const parse = (output: string) => parseCompletion(output, 0);

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
			spawn.mockImplementation(reply(QUOTED));

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
			spawn.mockImplementation(reply(MARKER));

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
			spawn.mockImplementation(reply(MARKER));

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
			spawn.mockImplementation(reply(MARKER));

			const result = await new LoopService({
				projectRoot: '/p',
				findReadyTask
			}).run({ ...config, ...overrides });

			expect(result.finalStatus).toBe('all_complete');
			expect(findReadyTask).not.toHaveBeenCalled();
		});

		describe('a blocked task (#938)', () => {
			const BLOCKED =
				'8.5 needs task 19.\n<loop-blocked>8.5 needs task 19</loop-blocked>\n';
			// HEAD moves on every iteration: Claude committed the rewired tasks
			const committing = () => {
				let n = 0;
				return async () => `sha${n++}`;
			};

			it('keeps going when Claude rewired the tasks and another is ready', async () => {
				const onError = vi.fn();
				spawn
					.mockImplementationOnce(reply(BLOCKED))
					.mockImplementation(reply(MARKER));

				const result = await new LoopService({
					projectRoot: '/p',
					findReadyTask: vi
						.fn()
						.mockResolvedValueOnce('10')
						.mockResolvedValue(undefined),
					headCommit: committing()
				}).run({ ...config, callbacks: { onError } });

				expect(result.totalIterations).toBe(2);
				expect(result.finalStatus).toBe('all_complete');
				expect(onError).toHaveBeenCalledWith(
					'Blocked: 8.5 needs task 19. Task 10 is ready, so continuing.',
					'warning'
				);
			});

			it('stops when the iteration changed nothing', async () => {
				const findReadyTask = vi.fn().mockResolvedValue('10');
				spawn.mockImplementation(reply(BLOCKED));

				const result = await new LoopService({
					projectRoot: '/p',
					findReadyTask,
					taskStatuses: async () => new Map([['8.5', 'pending' as const]]),
					headCommit: async () => 'same'
				}).run(config);

				expect(result.totalIterations).toBe(1);
				expect(result.finalStatus).toBe('blocked');
				expect(findReadyTask).not.toHaveBeenCalled();
			});

			it('stops when no task is ready', async () => {
				spawn.mockImplementation(reply(BLOCKED));

				const result = await new LoopService({
					projectRoot: '/p',
					findReadyTask: vi.fn().mockResolvedValue(undefined),
					headCommit: committing()
				}).run(config);

				expect(result.totalIterations).toBe(1);
				expect(result.finalStatus).toBe('blocked');
			});
		});

		it('starts no iteration when every task is done or cancelled', async () => {
			const result = await new LoopService({
				projectRoot: '/p',
				taskStatuses: async () =>
					new Map([
						['1', 'done' as const],
						['2', 'cancelled' as const]
					])
			}).run(config);

			expect(spawn).not.toHaveBeenCalled();
			expect(result.totalIterations).toBe(0);
			expect(result.finalStatus).toBe('all_complete');
		});

		it.each([
			['a task is in review', { prompt: 'default' }, 'review' as const],
			['the preset picks its own work', { prompt: 'linting' }, 'done' as const],
			['the run is pinned to one task', { taskId: '1' }, 'done' as const]
		])('still runs when %s', async (_name, overrides, status) => {
			spawn.mockImplementation(reply(MARKER));

			const result = await new LoopService({
				projectRoot: '/p',
				taskStatuses: async () => new Map([['1', status]])
			}).run({ ...config, ...overrides });

			expect(result.totalIterations).toBe(1);
		});

		it('leaves the marker out of the output it shows', async () => {
			const onOutput = vi.fn();
			spawn.mockImplementation(reply(MARKER));

			await new LoopService({ projectRoot: '/p' }).run({
				...config,
				iterations: 1,
				callbacks: { onOutput }
			});

			expect(onOutput).toHaveBeenCalledWith('All done.');
		});

		it('tells Claude where the marker must go', async () => {
			spawn.mockImplementation(reply(QUOTED));

			await new LoopService({ projectRoot: '/p' }).run({
				...config,
				iterations: 1
			});

			expect(spawn.mock.calls[0][1]?.[1]).toContain(
				'marker alone on the last line'
			);
		});
	});
});
