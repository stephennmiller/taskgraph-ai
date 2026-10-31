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
				isTaskPreset: () => false,
				resolveTask: async (id: string) => ({ id, title: 'Users table' })
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
			stripVTControlCharacters(String(c[0] ?? ''))
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
		expect(printed()).toContain('✓ Iteration 1 · $0.42 · 12 turns · 1m 23s');
		expect(printed()).toContain(
			'Iteration limit reached · 0 tasks completed in 1 iteration · $0.42 · 12 turns'
		);
	});

	it('says the budget stopped the run, and exits 0', async () => {
		run.mockResolvedValue(result({ finalStatus: 'budget_reached' }));

		await execute({ maxBudgetUsd: '1' });

		expect(printed()).toContain(
			'--max-budget-usd reached · 0 tasks completed in 1 iteration'
		);
		expect(process.exitCode).toBeUndefined();
	});

	it('says why an iteration failed, once, and exits 1 when the run ended on it (#861)', async () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		run.mockImplementation(async (config) => {
			config.callbacks.onIterationStart(1, 2);
			config.callbacks.onIterationEnd({
				iteration: 1,
				status: 'error',
				message: 'Claude Code reached the --max-turns limit',
				costUsd: 0.2,
				turns: 5
			});
			// Reported as it happened, so not repeated on the status line
			config.callbacks.onIterationStart(2, 2);
			config.callbacks.onError('Command terminated abnormally (no exit code)');
			config.callbacks.onIterationEnd({
				iteration: 2,
				status: 'error',
				message: 'Command terminated abnormally (no exit code)',
				costUnknown: true
			});
			return result({
				finalStatus: 'error',
				errorMessage: 'Command terminated abnormally (no exit code)',
				totalCostUsd: 0.2,
				costPartial: true,
				totalTurns: 5
			});
		});

		await execute({ maxTurns: '5' });

		expect(printed()).toEqual(
			expect.arrayContaining([
				'Iteration 1 of 2',
				'✗ Iteration 1 failed: Claude Code reached the --max-turns limit · $0.2 · 5 turns',
				'Iteration 2 of 2',
				'✗ Iteration 2 failed · cost unknown',
				// The error printed as it happened, so the summary doesn't repeat it
				'✗ Loop failed · 0 tasks completed in 1 iteration · at least $0.2 · 5 turns'
			])
		);
		expect(error).toHaveBeenCalledTimes(1);
		expect(process.exitCode).toBe(1);
	});

	it('prints one line per iteration on stdout, messages on stderr, and a one-line summary (#880)', async () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		run.mockImplementation(async (config) => {
			config.callbacks.onIterationStart(1, 1);
			config.callbacks.onError('Task 3 is ready\x1b[2J', 'warning');
			config.callbacks.onIterationEnd({
				iteration: 1,
				status: 'complete',
				costUsd: 1.42,
				turns: 61
			});
			return result({
				finalStatus: 'all_complete',
				tasksCompleted: 1,
				totalCostUsd: 1.42,
				totalTurns: 61
			});
		});

		await execute({ id: '3.2', output: false });

		expect(printed().slice(-4)).toEqual([
			'Iteration 1 of 1 · task 3.2',
			'✓ Iteration 1 · $1.42 · 61 turns',
			'',
			'✓ All tasks complete · 1 task completed in 1 iteration · $1.42 · 61 turns'
		]);
		expect(error).toHaveBeenCalledTimes(1);
		expect(stripVTControlCharacters(String(error.mock.calls[0][0]))).toBe(
			'Task 3 is ready'
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

	it("passes --model to tm-core and shows each iteration's model and effort", async () => {
		run.mockImplementation(async (config) => {
			config.callbacks.onIterationEnd({
				iteration: 1,
				status: 'success',
				model: 'opus',
				effort: 'low',
				costUsd: 0.42
			});
			return result();
		});

		await execute({ model: 'opus' });

		expect(run).toHaveBeenCalledWith(
			expect.objectContaining({ model: 'opus' })
		);
		expect(printed()).toContain('✓ Iteration 1 · opus, low effort · $0.42');
	});

	it('passes --reuse-session to tm-core and says whether each iteration resumed', async () => {
		run.mockImplementation(async (config) => {
			config.callbacks.onIterationEnd({
				iteration: 2,
				status: 'success',
				session: 'resumed',
				costUsd: 0.42
			});
			return result();
		});

		await execute({ reuseSession: true });

		expect(run).toHaveBeenCalledWith(
			expect.objectContaining({ reuseSession: true })
		);
		expect(printed()).toContain('✓ Iteration 2 · resumed · $0.42');
	});

	it('refuses a --model that would read as a flag, before starting tm-core', async () => {
		await expect(execute({ model: '--verbose' })).rejects.toThrow(
			'process.exit called'
		);

		expect(createTmCore).not.toHaveBeenCalled();
	});
});
