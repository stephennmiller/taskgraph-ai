/**
 * @fileoverview What each iteration costs, and the --max-turns and
 * --max-budget-usd caps (#837). The fake Claude prints stream-json, the
 * last event a `result` with the run's cost and turns.
 */

import * as childProcess from 'node:child_process';
import * as fsPromises from 'node:fs/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LoopConfig } from '../types.js';
import { fakeClaude } from './fake-claude.js';
import { parseLoopCaps } from './iteration-limits.js';
import { LoopService } from './loop.service.js';

vi.mock('node:child_process');
vi.mock('node:fs/promises');

/** stream-json output: an assistant message, then the result event */
const streamJson = (result: Record<string, unknown>) =>
	[
		JSON.stringify({
			type: 'assistant',
			message: { content: [{ type: 'text', text: 'Working' }] }
		}),
		JSON.stringify({ type: 'result', subtype: 'success', ...result }),
		''
	].join('\n');

const spends =
	(cost: number, turns: number, status = 0) =>
	() =>
		fakeClaude({
			stdout: streamJson({
				result: 'Did one task',
				total_cost_usd: cost,
				num_turns: turns
			}),
			status
		}) as never;

const config = (fields: Partial<LoopConfig> = {}): LoopConfig => ({
	prompt: 'default',
	iterations: 1,
	sleepSeconds: 0,
	progressFile: '/test/progress.txt',
	...fields
});

const argsOf = (call: number) =>
	vi.mocked(childProcess.spawn).mock.calls[call][1] as string[];
const flag = (args: string[], name: string) => {
	const at = args.indexOf(name);
	return at === -1 ? undefined : args[at + 1];
};
const written = () =>
	vi
		.mocked(fsPromises.appendFile)
		.mock.calls.map((c) => String(c[1]))
		.join('');

describe('LoopService cost and caps', () => {
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
	])(
		'records cost and turns from the result event (%s)',
		async (_, verbose) => {
			spawn.mockImplementation(spends(0.4213, 12));
			const onOutput = vi.fn();

			const result = await service.run(
				config({ verbose, callbacks: { onOutput } })
			);

			expect(flag(argsOf(0), '--output-format')).toBe('stream-json');
			expect(argsOf(0)).toContain('--verbose');
			expect(result.iterations[0]).toMatchObject({
				status: 'success',
				costUsd: 0.4213,
				turns: 12
			});
			expect(result).toMatchObject({ totalCostUsd: 0.4213, totalTurns: 12 });
			// Quiet mode prints the reply, not the JSON events
			if (!verbose) expect(onOutput).toHaveBeenCalledWith('Did one task');
		}
	);

	it("quiet mode doesn't print the JSON events of a run that died before its result event", async () => {
		const events = streamJson({ result: 'x' }).split('\n')[0];
		spawn.mockImplementation(
			() =>
				fakeClaude({
					stdout: `${events}\nplain text\n${events}\n`,
					status: 1
				}) as never
		);
		const onOutput = vi.fn();

		const result = await service.run(config({ callbacks: { onOutput } }));

		expect(onOutput).toHaveBeenCalledWith('plain text\n');
		expect(result.iterations[0]).toMatchObject({
			status: 'error',
			message: 'Exit code 1'
		});
	});

	it('reads completion markers from the result text', async () => {
		spawn.mockImplementation(
			() =>
				fakeClaude({
					stdout: streamJson({
						result: 'All done\n<loop-complete>DONE</loop-complete>',
						total_cost_usd: 0.1,
						num_turns: 2
					})
				}) as never
		);

		const result = await service.run(config({ iterations: 3 }));

		expect(result.finalStatus).toBe('all_complete');
		expect(result.totalIterations).toBe(1);
	});

	it('leaves cost out when the result event has none, or the wrong type', async () => {
		spawn.mockImplementation(
			() =>
				fakeClaude({
					stdout: streamJson({ result: 'ok', total_cost_usd: '0.5' })
				}) as never
		);

		const result = await service.run(config());

		expect(result.iterations[0].costUsd).toBeUndefined();
		expect(result.totalCostUsd).toBeUndefined();
	});

	it('logs each iteration and the total in the progress file', async () => {
		spawn.mockImplementation(spends(0.6, 5));

		await service.run(config({ iterations: 2 }));

		expect(written()).toMatch(
			/# Iteration 1: success · fresh · \$0\.60 · 5 turns · \d+s\n/
		);
		expect(written()).toMatch(
			/# Iteration 2: success · fresh · \$0\.60 · 5 turns/
		);
		expect(written()).toContain('- Spent: $1.20 · 10 turns');
	});

	it('passes --max-turns to every claude -p and says when Claude hit it', async () => {
		spawn.mockImplementation(
			() =>
				fakeClaude({
					stdout: streamJson({
						subtype: 'error_max_turns',
						total_cost_usd: 0.2,
						num_turns: 3
					}),
					status: 1
				}) as never
		);

		const result = await service.run(config({ maxTurns: 3 }));

		expect(flag(argsOf(0), '--max-turns')).toBe('3');
		expect(result.iterations[0]).toMatchObject({
			status: 'error',
			message: 'Claude Code reached the --max-turns limit',
			turns: 3
		});
	});

	it('gives each iteration what is left of --max-budget-usd and stops once it is spent', async () => {
		spawn.mockImplementation(spends(0.6, 5));

		const result = await service.run(
			config({ iterations: 5, maxBudgetUsd: 1 })
		);

		expect(spawn).toHaveBeenCalledTimes(2);
		expect(flag(argsOf(0), '--max-budget-usd')).toBe('1');
		expect(flag(argsOf(1), '--max-budget-usd')).toBe('0.4');
		expect(result).toMatchObject({
			finalStatus: 'budget_reached',
			totalIterations: 2,
			totalCostUsd: 1.2
		});
		expect(written()).toContain('- Final status: budget_reached');
	});

	it('passes the caps through the Docker sandbox too', async () => {
		spawn.mockImplementation(spends(0.1, 1));

		await service.run(config({ sandbox: true, maxTurns: 9, maxBudgetUsd: 2 }));

		const args = argsOf(0);
		expect(spawn.mock.calls[0][0]).toBe('docker');
		const claudeArgs = args.slice(args.indexOf('--') + 1);
		expect(flag(claudeArgs, '--output-format')).toBe('stream-json');
		expect(flag(claudeArgs, '--max-turns')).toBe('9');
		expect(flag(claudeArgs, '--max-budget-usd')).toBe('2');
	});

	it('runs no cap flags without the options', async () => {
		spawn.mockImplementation(spends(0.1, 1));

		await service.run(config());

		expect(argsOf(0)).not.toContain('--max-turns');
		expect(argsOf(0)).not.toContain('--max-budget-usd');
	});
});

describe('parseLoopCaps', () => {
	it('takes whole turn counts and dollar amounts', () => {
		expect(parseLoopCaps({ maxTurns: '50', maxBudgetUsd: '$2.50' })).toEqual({
			maxTurns: 50,
			maxBudgetUsd: 2.5
		});
		expect(parseLoopCaps({})).toEqual({});
	});

	it.each(['0', '-1', '2.5', 'ten', ''])('refuses --max-turns %j', (value) => {
		expect(() => parseLoopCaps({ maxTurns: value })).toThrow('--max-turns');
	});

	it.each(['0', '0.001', '-5', '1e3', 'five', ''])(
		'refuses --max-budget-usd %j',
		(value) => {
			expect(() => parseLoopCaps({ maxBudgetUsd: value })).toThrow(
				'--max-budget-usd'
			);
		}
	);
});
