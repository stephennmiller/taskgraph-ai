/**
 * @fileoverview Resuming the previous iteration's Claude Code session (#841).
 * The fake Claude prints stream-json: an assistant event whose usage sizes
 * the context, then a result event with the session ID.
 */

import * as childProcess from 'node:child_process';
import * as fsPromises from 'node:fs/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LoopConfig } from '../types.js';
import { fakeClaude } from './fake-claude.js';
import { LoopService } from './loop.service.js';

vi.mock('node:child_process');
vi.mock('node:fs/promises');

/** One run in session `id` whose last API call sent `context` tokens */
const session = (id: string, context: number, status = 0) =>
	fakeClaude({
		stdout: [
			JSON.stringify({
				type: 'assistant',
				message: {
					content: [{ type: 'text', text: 'Working' }],
					usage: {
						input_tokens: 10,
						cache_creation_input_tokens: 1000,
						cache_read_input_tokens: context - 1010
					}
				}
			}),
			// A subagent's call doesn't size the main session
			JSON.stringify({
				type: 'assistant',
				parent_tool_use_id: 'toolu_1',
				message: { content: [], usage: { input_tokens: 999_999 } }
			}),
			JSON.stringify({
				type: 'result',
				subtype: status ? 'error_during_execution' : 'success',
				result: 'Did one task',
				session_id: id,
				total_cost_usd: 0.1,
				num_turns: 2
			}),
			''
		].join('\n'),
		status
	}) as never;

const config = (fields: Partial<LoopConfig> = {}): LoopConfig => ({
	prompt: 'default',
	iterations: 3,
	sleepSeconds: 0,
	progressFile: '/test/progress.txt',
	...fields
});

const resumedFrom = (call: number) => {
	const args = vi.mocked(childProcess.spawn).mock.calls[call][1] as string[];
	const at = args.indexOf('--resume');
	return at === -1 ? undefined : args[at + 1];
};
const written = () =>
	vi
		.mocked(fsPromises.appendFile)
		.mock.calls.map((c) => String(c[1]))
		.join('');

describe('LoopService session resume', () => {
	const spawn = vi.mocked(childProcess.spawn);
	let service: LoopService;

	beforeEach(() => {
		vi.resetAllMocks();
		vi.mocked(fsPromises.mkdir).mockResolvedValue(undefined);
		vi.mocked(fsPromises.appendFile).mockResolvedValue(undefined);
		service = new LoopService({ projectRoot: '/test/project' });
	});

	it.each([
		['quiet', false],
		['--verbose', true]
	])('resumes the last session for the next task (%s)', async (_, verbose) => {
		spawn
			.mockImplementationOnce(() => session('s-1', 20_000))
			.mockImplementationOnce(() => session('s-1', 40_000))
			.mockImplementationOnce(() => session('s-1', 60_000));

		const result = await service.run(config({ verbose }));

		expect([0, 1, 2].map(resumedFrom)).toEqual([undefined, 's-1', 's-1']);
		expect(result.iterations.map((it) => it.session)).toEqual([
			'fresh',
			'resumed',
			'resumed'
		]);
		expect(result.iterations[0]).toMatchObject({
			sessionId: 's-1',
			contextTokens: 20_000
		});
		expect(written()).toMatch(/# Iteration 1: success · fresh · /);
		expect(written()).toMatch(/# Iteration 2: success · resumed · /);
	});

	it('starts fresh once the context reaches the limit', async () => {
		spawn
			.mockImplementationOnce(() => session('s-1', 49_999))
			.mockImplementationOnce(() => session('s-1', 50_000))
			.mockImplementationOnce(() => session('s-2', 5_000));

		await service.run(config({ resumeMaxContextTokens: 50_000 }));

		expect([0, 1, 2].map(resumedFrom)).toEqual([undefined, 's-1', undefined]);
	});

	it('starts fresh after an iteration that failed', async () => {
		spawn
			.mockImplementationOnce(() => session('s-1', 1_000, 1))
			.mockImplementationOnce(() => session('s-2', 1_000))
			.mockImplementationOnce(() => session('s-2', 2_000));

		const result = await service.run(config());

		expect(result.iterations[0].status).toBe('error');
		expect([0, 1, 2].map(resumedFrom)).toEqual([undefined, undefined, 's-2']);
	});

	it('starts every iteration fresh with --fresh, or a limit of 0', async () => {
		spawn.mockImplementation(() => session('s-1', 1_000));

		const fresh = await service.run(config({ fresh: true }));
		const off = await service.run(config({ resumeMaxContextTokens: 0 }));

		expect(spawn.mock.calls.map((_, i) => resumedFrom(i))).toEqual(
			Array(6).fill(undefined)
		);
		expect(fresh.iterations.every((it) => it.session === 'fresh')).toBe(true);
		expect(off.iterations.every((it) => it.session === 'fresh')).toBe(true);
	});

	it("doesn't resume in the Docker sandbox, whose sessions stay in the container", async () => {
		spawn.mockImplementation(() => session('s-1', 1_000));

		await service.run(config({ sandbox: true, iterations: 2 }));

		expect(resumedFrom(1)).toBeUndefined();
	});

	it('starts fresh when the next task runs at another model or effort', async () => {
		const scores: Record<string, number> = { '1': 2, '2': 2, '3': 8 };
		const ids = ['1', '2', '3'];
		service = new LoopService({
			projectRoot: '/test/project',
			findReadyTask: async () => ids.shift(),
			taskComplexity: async (id) => scores[id]
		});
		spawn.mockImplementation(() => session('s-1', 1_000));

		const result = await service.run(
			config({
				bands: [
					{ maxScore: 3, model: 'sonnet', effort: 'low' },
					{ maxScore: 10, effort: 'high' }
				]
			})
		);

		expect(result.iterations.map((it) => it.model ?? it.effort)).toEqual([
			'sonnet',
			'sonnet',
			'high'
		]);
		expect([0, 1, 2].map(resumedFrom)).toEqual([undefined, 's-1', undefined]);
	});

	it('starts fresh when the run reported no context size', async () => {
		spawn.mockImplementation(
			() =>
				fakeClaude({
					stdout: `${JSON.stringify({ type: 'result', result: 'ok', session_id: 's-1' })}\n`
				}) as never
		);

		await service.run(config({ iterations: 2 }));

		expect(resumedFrom(1)).toBeUndefined();
	});

	it('never passes a session ID that would read as a flag', async () => {
		spawn.mockImplementation(() => session('--dangerous', 1_000));

		const result = await service.run(config({ iterations: 2 }));

		expect(result.iterations[0].sessionId).toBeUndefined();
		expect(resumedFrom(1)).toBeUndefined();
	});
});
