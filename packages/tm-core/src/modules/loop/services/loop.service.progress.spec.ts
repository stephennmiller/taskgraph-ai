/**
 * @fileoverview What a loop run counts as a completed task, and when it
 * stops for making no progress (#812)
 */

import * as childProcess from 'node:child_process';
import * as fsPromises from 'node:fs/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskStatus } from '../../../common/types/index.js';
import type { LoopConfig } from '../types.js';
import { fakeClaude } from './fake-claude.js';
import { LoopService } from './loop.service.js';

vi.mock('node:child_process');
vi.mock('node:fs/promises');

const config: LoopConfig = {
	prompt: 'default',
	iterations: 4,
	sleepSeconds: 0,
	progressFile: '/test/progress.txt'
};

/** Snapshots the lookup returns in turn, the last one from then on */
const snapshots = (...states: Record<string, TaskStatus>[]) => {
	const lookup = vi.fn();
	for (const s of states.slice(0, -1)) {
		lookup.mockResolvedValueOnce(new Map(Object.entries(s)));
	}
	return lookup.mockResolvedValue(new Map(Object.entries(states.at(-1)!)));
};

describe('LoopService progress', () => {
	const spawn = vi.mocked(childProcess.spawn);

	beforeEach(() => {
		vi.resetAllMocks();
		vi.mocked(fsPromises.mkdir).mockResolvedValue(undefined);
		vi.mocked(fsPromises.appendFile).mockResolvedValue(undefined);
		spawn.mockImplementation(
			() => fakeClaude({ stdout: 'Worked on it.\n' }) as never
		);
	});

	it('stops with an error after two iterations that change no status, naming the task', async () => {
		const taskStatuses = snapshots({ '1': 'pending', '2': 'pending' });
		const onError = vi.fn();

		const result = await new LoopService({
			projectRoot: '/p',
			taskStatuses,
			findReadyTask: vi.fn().mockResolvedValue('1')
		}).run({ ...config, callbacks: { onError } });

		expect(result).toMatchObject({
			totalIterations: 2,
			tasksCompleted: 0,
			finalStatus: 'error'
		});
		expect(result.errorMessage).toContain('Task 1');
		expect(onError).toHaveBeenCalledWith(result.errorMessage, 'error');
		expect(spawn).toHaveBeenCalledTimes(2);
	});

	it('counts nothing without a status lookup, however often Claude exits 0', async () => {
		const result = await new LoopService({ projectRoot: '/p' }).run({
			...config,
			iterations: 3
		});

		expect(result).toMatchObject({
			totalIterations: 3,
			tasksCompleted: 0,
			finalStatus: 'max_iterations'
		});
		expect(spawn).toHaveBeenCalledTimes(3);
	});

	it('counts only the tasks whose status moved to done or review', async () => {
		const taskStatuses = snapshots(
			{ '1': 'pending', '2': 'pending', '2.1': 'pending' },
			{ '1': 'done', '2': 'in-progress', '2.1': 'review' },
			{ '1': 'done', '2': 'in-progress', '2.1': 'done' }
		);

		const result = await new LoopService({
			projectRoot: '/p',
			taskStatuses
		}).run({ ...config, iterations: 2 });

		expect(result).toMatchObject({
			totalIterations: 2,
			tasksCompleted: 2,
			finalStatus: 'max_iterations'
		});
	});

	it('resets the count when an iteration changes a status', async () => {
		const taskStatuses = snapshots(
			{ '1': 'pending' },
			{ '1': 'pending' },
			{ '1': 'in-progress' },
			{ '1': 'in-progress' }
		);

		const result = await new LoopService({
			projectRoot: '/p',
			taskStatuses
		}).run({ ...config, iterations: 3 });

		expect(result.finalStatus).toBe('max_iterations');
		expect(result.totalIterations).toBe(3);
	});

	it('names the pinned task when an --id run is stuck', async () => {
		const result = await new LoopService({
			projectRoot: '/p',
			taskStatuses: snapshots({ '3.2': 'pending' })
		}).run({ ...config, taskId: '3.2' });

		expect(result.finalStatus).toBe('error');
		expect(result.errorMessage).toContain('Task 3.2');
	});

	it("doesn't stop a preset that picks its own work", async () => {
		const result = await new LoopService({
			projectRoot: '/p',
			taskStatuses: snapshots({ '1': 'pending' })
		}).run({ ...config, prompt: 'linting' });

		expect(result).toMatchObject({
			totalIterations: 4,
			tasksCompleted: 0,
			finalStatus: 'max_iterations'
		});
	});

	it('counts a task Claude finished in the iteration that says all done', async () => {
		spawn.mockImplementation(
			() =>
				fakeClaude({
					stdout: 'Done.\n<loop-complete>ALL_DONE</loop-complete>\n'
				}) as never
		);

		const result = await new LoopService({
			projectRoot: '/p',
			taskStatuses: snapshots({ '1': 'in-progress' }, { '1': 'done' })
		}).run(config);

		expect(result).toMatchObject({
			tasksCompleted: 1,
			finalStatus: 'all_complete'
		});
	});

	it('keeps going without counting when the tasks file cannot be read', async () => {
		const onError = vi.fn();

		const result = await new LoopService({
			projectRoot: '/p',
			taskStatuses: vi.fn().mockRejectedValue(new Error('EIO'))
		}).run({ ...config, callbacks: { onError } });

		expect(result).toMatchObject({
			totalIterations: 4,
			tasksCompleted: 0,
			finalStatus: 'max_iterations'
		});
		expect(onError).toHaveBeenCalledWith(
			expect.stringContaining('EIO'),
			'warning'
		);
	});

	it('--verbose keeps a character split across two output chunks', async () => {
		const line = Buffer.from(
			`${JSON.stringify({
				type: 'assistant',
				message: { content: [{ type: 'text', text: 'café ✓' }] }
			})}\n`
		);
		const cut = line.indexOf(Buffer.from('é')) + 1;
		spawn.mockImplementation(() => {
			const child = fakeClaude({ hang: true });
			setImmediate(() => {
				child.stdout.write(line.subarray(0, cut));
				setImmediate(() => {
					child.stdout.end(line.subarray(cut));
					child.stderr.end();
					setImmediate(() => child.emit('close', 0));
				});
			});
			return child as never;
		});
		const onText = vi.fn();

		await new LoopService({ projectRoot: '/p' }).run({
			...config,
			iterations: 1,
			verbose: true,
			callbacks: { onText }
		});

		expect(onText).toHaveBeenCalledWith('café ✓');
	});
});
