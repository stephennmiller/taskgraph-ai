/**
 * @fileoverview Each iteration runs at the model and effort its task's
 * complexity score picks (#838)
 */

import * as childProcess from 'node:child_process';
import * as fsPromises from 'node:fs/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_LOOP_BANDS } from '../model-bands.js';
import type { LoopConfig } from '../types.js';
import { fakeClaude } from './fake-claude.js';
import { LoopService } from './loop.service.js';

vi.mock('node:child_process');
vi.mock('node:fs/promises');

const config = (fields: Partial<LoopConfig> = {}): LoopConfig => ({
	prompt: 'default',
	iterations: 1,
	sleepSeconds: 0,
	progressFile: '/test/progress.txt',
	bands: DEFAULT_LOOP_BANDS,
	...fields
});

const args = () => vi.mocked(childProcess.spawn).mock.calls[0][1] as string[];
const flag = (name: string) => {
	const all = args();
	const at = all.indexOf(name);
	return at === -1 ? undefined : all[at + 1];
};

describe('LoopService model and effort', () => {
	const scores: Record<string, unknown> = { '1': 2, '2': 9, '3': undefined };
	const taskComplexity = vi.fn(async (id: string) => scores[id]);

	beforeEach(() => {
		vi.resetAllMocks();
		vi.mocked(fsPromises.mkdir).mockResolvedValue(undefined);
		vi.mocked(fsPromises.appendFile).mockResolvedValue(undefined);
		taskComplexity.mockImplementation(async (id: string) => scores[id]);
		vi.mocked(childProcess.spawn).mockImplementation(
			() => fakeClaude({ stdout: 'Done' }) as never
		);
	});

	const service = (next = '1') =>
		new LoopService({
			projectRoot: '/test/project',
			findReadyTask: async () => next,
			taskComplexity
		});

	it('runs a low-scoring pinned task on the cheaper model at low effort', async () => {
		const result = await service().run(config({ taskId: '1' }));

		expect(taskComplexity).toHaveBeenCalledWith('1', undefined);
		expect(flag('--model')).toBe('sonnet');
		expect(flag('--effort')).toBe('low');
		expect(result.iterations[0]).toMatchObject({
			complexity: 2,
			model: 'sonnet',
			effort: 'low'
		});
		const logged = vi
			.mocked(fsPromises.appendFile)
			.mock.calls.map((c) => String(c[1]))
			.join('');
		expect(logged).toContain(
			'# Iteration 1: success · fresh · complexity 2 · sonnet, low effort'
		);
	});

	it('scores the task taskgraph next would pick when none is pinned', async () => {
		await service('2').run(config());

		expect(taskComplexity).toHaveBeenCalledWith('2', undefined);
		expect(flag('--model')).toBeUndefined();
		expect(flag('--effort')).toBe('high');
	});

	it('runs as before when the task has no score', async () => {
		const result = await service('3').run(config());

		expect(args()).not.toContain('--model');
		expect(args()).not.toContain('--effort');
		expect(result.iterations[0].model).toBeUndefined();
	});

	it("lets --model replace the band's model for every iteration", async () => {
		await service().run(config({ taskId: '1', model: 'opus' }));

		expect(flag('--model')).toBe('opus');
		expect(flag('--effort')).toBe('low');
	});

	it('runs as before when the score lookup fails', async () => {
		taskComplexity.mockRejectedValue(new Error('tasks.json is broken'));

		await service().run(config({ taskId: '1' }));

		expect(args()).not.toContain('--effort');
	});

	it("doesn't score a preset that picks its own work", async () => {
		await service().run(config({ prompt: 'linting' }));

		expect(taskComplexity).not.toHaveBeenCalled();
		expect(args()).not.toContain('--effort');
	});
});
