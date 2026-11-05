/**
 * @fileoverview A stuck task is set to blocked and the run moves on to the
 * next ready one, unless none is ready or the setup is broken (#997)
 */

import * as childProcess from 'node:child_process';
import * as fsPromises from 'node:fs/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LoopConfig } from '../types.js';
import { fakeClaude } from './fake-claude.js';
import { LoopService } from './loop.service.js';

vi.mock('node:child_process');
vi.mock('node:fs/promises');

const config: LoopConfig = {
	prompt: 'default',
	iterations: 3,
	sleepSeconds: 0,
	progressFile: '/test/progress.txt'
};

/** Tasks `next` picks in order, skipping the ones blockTask blocked */
const project = (...ids: string[]) => {
	const blocked = new Set<string>();
	return {
		projectRoot: '/p',
		taskStatuses: vi.fn().mockResolvedValue(new Map([['1', 'pending']])),
		findReadyTask: vi.fn(async () => ids.find((id) => !blocked.has(id))),
		blockTask: vi.fn(async (id: string) => {
			blocked.add(id);
		})
	};
};

describe('LoopService stuck tasks', () => {
	const spawn = vi.mocked(childProcess.spawn);

	beforeEach(() => {
		vi.resetAllMocks();
		vi.mocked(fsPromises.mkdir).mockResolvedValue(undefined);
		vi.mocked(fsPromises.appendFile).mockResolvedValue(undefined);
		spawn.mockImplementation(
			() => fakeClaude({ stdout: 'Worked on it.\n' }) as never
		);
	});

	it('blocks a task that made no progress, with a note, and goes on to the next ready task', async () => {
		const options = project('1', '2');
		const onError = vi.fn();

		const result = await new LoopService(options).run({
			...config,
			callbacks: { onError }
		});

		const reason = 'stuck: no progress in 2 sessions';
		expect(options.blockTask).toHaveBeenCalledExactlyOnceWith(
			'1',
			reason,
			undefined
		);
		expect(result).toMatchObject({
			totalIterations: 3,
			finalStatus: 'max_iterations',
			setAside: [{ id: '1', reason }]
		});
		expect(onError).toHaveBeenCalledWith(
			expect.stringContaining('continuing with task 2'),
			'warning'
		);
	});

	it('stops when no other task is ready, listing the one it set aside', async () => {
		const options = project('1');

		const result = await new LoopService(options).run(config);

		expect(result).toMatchObject({
			totalIterations: 2,
			finalStatus: 'error',
			setAside: [{ id: '1' }]
		});
		expect(result.errorMessage).toContain('Task 1 is stuck');
	});

	it('blocks a task that failed 3 times in a row, noting the last error', async () => {
		spawn.mockImplementation(() => fakeClaude({ status: 1 }) as never);
		const options = project('1', '2');

		const result = await new LoopService(options).run({
			...config,
			iterations: 3
		});

		expect(options.blockTask).toHaveBeenCalledExactlyOnceWith(
			'1',
			expect.stringContaining('stuck: 3 failed sessions in a row. Last error:'),
			undefined
		);
		expect(result.setAside).toHaveLength(1);
	});

	it('stops at once when the error that set a task aside comes back on the next task', async () => {
		spawn.mockImplementation(() => fakeClaude({ status: 1 }) as never);
		const options = project('1', '2', '3');

		const result = await new LoopService(options).run({
			...config,
			iterations: 10
		});

		expect(result).toMatchObject({ totalIterations: 4, finalStatus: 'error' });
		expect(options.blockTask).toHaveBeenCalledOnce();
	});

	it('stops at once, setting nothing aside, when the Claude CLI is missing', async () => {
		spawn.mockImplementation(
			() =>
				fakeClaude({
					error: Object.assign(new Error('spawn claude ENOENT'), {
						code: 'ENOENT'
					})
				}) as never
		);
		const options = project('1', '2');

		const result = await new LoopService(options).run(config);

		expect(result).toMatchObject({ totalIterations: 1, finalStatus: 'error' });
		expect(options.blockTask).not.toHaveBeenCalled();
		expect(result.setAside).toBeUndefined();
	});

	it('stops as before when the run is pinned to one task', async () => {
		const options = project('1', '2');

		const result = await new LoopService(options).run({
			...config,
			taskId: '1'
		});

		expect(result).toMatchObject({ totalIterations: 2, finalStatus: 'error' });
		expect(options.blockTask).not.toHaveBeenCalled();
	});

	it('stops as before when blocking the task fails', async () => {
		const options = project('1', '2');
		options.blockTask.mockRejectedValue(new Error('locked'));

		const result = await new LoopService(options).run(config);

		expect(result).toMatchObject({ totalIterations: 2, finalStatus: 'error' });
		expect(result.setAside).toBeUndefined();
	});
});
