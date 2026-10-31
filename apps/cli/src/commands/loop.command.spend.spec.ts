/**
 * @fileoverview What `loop` prints about cost and turns, and its
 * --max-turns and --max-budget-usd flags (#837)
 */

import { stripVTControlCharacters } from 'node:util';
import {
	type Mock,
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	vi
} from 'vitest';

vi.mock('@tm/core', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@tm/core')>();
	return {
		...actual,
		createTmCore: vi.fn()
	};
});
vi.mock('../utils/display-helpers.js', () => ({
	displayCommandHeader: vi.fn()
}));
vi.mock('../utils/error-handler.js', () => ({ displayError: vi.fn() }));
vi.mock('../utils/project-root.js', () => ({
	getProjectRoot: vi.fn().mockReturnValue('/test/project')
}));

import { type LoopResult, createTmCore } from '@tm/core';
import { displayError } from '../utils/error-handler.js';
import { getProjectRoot } from '../utils/project-root.js';
import { LoopCommand } from './loop.command.js';

const result = (fields: Partial<LoopResult> = {}): LoopResult => ({
	iterations: [],
	totalIterations: 1,
	tasksCompleted: 0,
	finalStatus: 'max_iterations',
	...fields
});

describe('LoopCommand cost and caps', () => {
	const run = vi.fn();
	let log: Mock;

	beforeEach(() => {
		vi.clearAllMocks();
		process.exitCode = undefined;
		vi.mocked(getProjectRoot).mockReturnValue('/test/project');
		log = vi.spyOn(console, 'log').mockImplementation(() => {}) as never;
		vi.spyOn(process, 'exit').mockImplementation(() => {
			throw new Error('process.exit called');
		});
		vi.mocked(createTmCore).mockResolvedValue({
			projectPath: '/test/project',
			loop: {
				run,
				isTrusted: () => true,
				resolveIterations: () => 1,
				isPreset: () => true,
				isTaskPreset: () => false
			},
			tasks: { getCount: async () => 0 },
			config: { getActiveTag: () => 'master' }
		} as never);
	});

	afterEach(() => {
		vi.restoreAllMocks();
		process.exitCode = undefined;
	});

	const execute = (options: Record<string, unknown>) =>
		(new LoopCommand() as any).execute({ trust: true, ...options });
	const printed = () =>
		log.mock.calls.map((c: unknown[]) =>
			stripVTControlCharacters(String(c[0]))
		);

	it('passes the caps to tm-core and prints what each iteration and the run spent', async () => {
		run.mockImplementation(async (config) => {
			config.callbacks.onIterationEnd({
				iteration: 1,
				status: 'success',
				costUsd: 0.42,
				turns: 12,
				duration: 83_000
			});
			return result({ totalCostUsd: 0.42, totalTurns: 12 });
		});

		await execute({ maxTurns: '30', maxBudgetUsd: '5' });

		expect(run).toHaveBeenCalledWith(
			expect.objectContaining({ maxTurns: 30, maxBudgetUsd: 5 })
		);
		expect(printed()).toContain(
			'  Iteration 1 completed: success · $0.42 · 12 turns · 1m 23s'
		);
		expect(printed()).toContain('Total iterations: 1 · $0.42 · 12 turns');
	});

	it('says the budget stopped the run, and exits 0', async () => {
		run.mockResolvedValue(result({ finalStatus: 'budget_reached' }));

		await execute({ maxBudgetUsd: '1' });

		expect(printed()).toContain(
			'Final status: Budget reached (--max-budget-usd)'
		);
		expect(process.exitCode).toBeUndefined();
	});

	it('refuses a bad --max-budget-usd before starting tm-core', async () => {
		await expect(execute({ maxBudgetUsd: 'lots' })).rejects.toThrow(
			'process.exit called'
		);

		expect(createTmCore).not.toHaveBeenCalled();
		expect(displayError).toHaveBeenCalledWith(
			expect.objectContaining({
				message: '"lots" isn\'t a dollar amount for --max-budget-usd'
			}),
			{ skipExit: true }
		);
	});
});
