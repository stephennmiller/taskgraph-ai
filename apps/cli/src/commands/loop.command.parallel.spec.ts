/**
 * @fileoverview LoopCommand with --parallel: tm-core is mocked; the command
 * only checks flags, hands off to tm-core, and prints the summary
 */

import {
	type Mock,
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	vi
} from 'vitest';
import { LoopCommand } from './loop.command.js';

vi.mock('@tm/core', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@tm/core')>();
	return {
		createTmCore: vi.fn(),
		PRESET_NAMES: ['default'],
		// Flag checks are tm-core logic the command relies on: use the real ones
		MAX_PARALLEL: actual.MAX_PARALLEL,
		ParallelLoopError: actual.ParallelLoopError,
		assertParallelFlags: actual.assertParallelFlags,
		assertContainerFlags: actual.assertContainerFlags,
		DEFAULT_CONTAINER_IMAGE: actual.DEFAULT_CONTAINER_IMAGE,
		parseParallelCount: actual.parseParallelCount,
		parseLoopCaps: actual.parseLoopCaps,
		// So is making task text safe to print
		sanitizeForTerminal: actual.sanitizeForTerminal,
		stripTerminalControls: actual.stripTerminalControls
	};
});

vi.mock('../utils/error-handler.js', () => ({ displayError: vi.fn() }));

vi.mock('../utils/project-root.js', () => ({
	getProjectRoot: vi.fn().mockReturnValue('/test/project')
}));

import type { ParallelLoopResult } from '@tm/core';
import { createTmCore } from '@tm/core';
import { displayError } from '../utils/error-handler.js';
import { getProjectRoot } from '../utils/project-root.js';

describe('LoopCommand --parallel', () => {
	const execute = (options: Record<string, unknown>) =>
		(loopCommand as any).execute.bind(loopCommand)(options);
	const parallelResult = (
		overrides: Partial<ParallelLoopResult> = {}
	): ParallelLoopResult => ({
		tasks: [
			{
				id: '3',
				title: 'Build the login API',
				branch: 'taskgraph/task-3',
				worktree: '/test/project/.taskgraph/worktrees/task-3',
				logFile: '/test/project/.taskgraph/worktrees/task-3.log',
				state: 'done',
				startedAt: 0,
				durationMs: 1000,
				commits: 2,
				uncommitted: false,
				kept: true,
				claimed: false,
				finished: true
			}
		],
		readyCount: 1,
		skippedIds: [],
		aborted: false,
		...overrides
	});
	let runParallel: Mock;
	let mockLoopRun: Mock;
	let consoleLogSpy: ReturnType<typeof vi.spyOn>;
	let loopCommand: LoopCommand;

	beforeEach(() => {
		vi.clearAllMocks();
		(getProjectRoot as Mock).mockReturnValue('/test/project');
		consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
		runParallel = vi.fn().mockResolvedValue(parallelResult());
		mockLoopRun = vi.fn();
		(createTmCore as Mock).mockResolvedValue({
			projectPath: '/test/project',
			loop: {
				run: mockLoopRun,
				runParallel,
				checkContainer: vi.fn(),
				isTrusted: vi.fn().mockReturnValue(true),
				trust: vi.fn()
			}
		});
		loopCommand = new LoopCommand();
		process.exitCode = undefined;
	});

	afterEach(() => {
		consoleLogSpy.mockRestore();
		process.exitCode = undefined;
	});

	it('hands the count, tag and an abort signal to tm-core, then prints the summary', async () => {
		await execute({ parallel: '3', tag: 'api', trust: true });

		expect(runParallel).toHaveBeenCalledWith(
			expect.objectContaining({
				parallel: 3,
				tag: 'api',
				signal: expect.any(AbortSignal)
			})
		);
		expect(mockLoopRun).not.toHaveBeenCalled();
		const output = consoleLogSpy.mock.calls.flat().join('\n');
		expect(output).toContain('1 of 1 task done');
		expect(output).toContain('taskgraph/task-3');
		expect(process.exitCode).toBeUndefined();
	});

	it('refuses a bad count before starting tm-core', async () => {
		await execute({ parallel: 'lots' });

		expect(createTmCore).not.toHaveBeenCalled();
		expect(displayError).toHaveBeenCalledWith(
			expect.objectContaining({
				message: '"lots" isn\'t a task count for --parallel'
			}),
			{ skipExit: true }
		);
		expect(process.exitCode).toBe(1);
	});

	it('passes --container and its image to tm-core', async () => {
		await execute({
			parallel: '2',
			trust: true,
			container: true,
			containerImage: 'my/image:1'
		});

		expect(runParallel).toHaveBeenCalledWith(
			expect.objectContaining({ container: { image: 'my/image:1' } })
		);
	});

	it('passes --max-turns and --max-budget-usd to tm-core', async () => {
		await execute({
			parallel: '2',
			trust: true,
			maxTurns: '40',
			maxBudgetUsd: '6'
		});

		expect(runParallel).toHaveBeenCalledWith(
			expect.objectContaining({ maxTurns: 40, maxBudgetUsd: 6 })
		);
	});

	it('checks what --container needs before asking for approval', async () => {
		const core = await (createTmCore as Mock)();
		core.loop.checkContainer.mockRejectedValue(new Error('no token'));

		await execute({ parallel: '2', container: true });

		expect(core.loop.checkContainer).toHaveBeenCalledWith({ image: undefined });
		expect(core.loop.isTrusted).not.toHaveBeenCalled();
		expect(runParallel).not.toHaveBeenCalled();
		expect(process.exitCode).toBe(1);
	});

	it('refuses --container without --parallel before starting tm-core', async () => {
		const exit = vi.spyOn(process, 'exit').mockImplementation(() => {
			throw new Error('process.exit called');
		});

		await expect(execute({ container: true })).rejects.toThrow(
			'process.exit called'
		);

		expect(createTmCore).not.toHaveBeenCalled();
		expect(displayError).toHaveBeenCalledWith(
			expect.objectContaining({
				message: '--container only works with --parallel'
			}),
			{ skipExit: true }
		);
		expect(exit).toHaveBeenCalledWith(1);
		exit.mockRestore();
	});

	it('refuses flags it cannot combine with', async () => {
		await execute({ parallel: '2', verbose: true });

		expect(runParallel).not.toHaveBeenCalled();
		expect(displayError).toHaveBeenCalledWith(
			expect.objectContaining({
				message: "--parallel can't be combined with --verbose"
			}),
			{ skipExit: true }
		);
	});

	it("without --trust off a terminal, asks for --trust and doesn't suggest --sandbox", async () => {
		(createTmCore as Mock).mockResolvedValueOnce({
			projectPath: '/test/project',
			loop: { runParallel, isTrusted: vi.fn().mockReturnValue(false) }
		});
		const stdinTTY = process.stdin.isTTY;
		process.stdin.isTTY = false as never;
		try {
			await execute({ parallel: '2' });
		} finally {
			process.stdin.isTTY = stdinTTY;
		}

		expect(runParallel).not.toHaveBeenCalled();
		const [error] = (displayError as Mock).mock.calls[0];
		expect(error.message).toContain(
			'up to 2 Claude Code processes at once, with permission prompts off'
		);
		expect(error.message).toContain('--trust');
		expect(error.message).not.toContain('--sandbox');
	});

	it('exits 1 when a task failed and 130 when stopped', async () => {
		runParallel.mockResolvedValueOnce(
			parallelResult({
				tasks: [
					{
						...parallelResult().tasks[0],
						state: 'failed',
						error: 'exit 1',
						kept: false
					}
				]
			})
		);
		await execute({ parallel: '1', trust: true });
		expect(process.exitCode).toBe(1);

		process.exitCode = undefined;
		runParallel.mockResolvedValueOnce(parallelResult({ aborted: true }));
		await execute({ parallel: '1', trust: true });
		expect(process.exitCode).toBe(130);
	});
});
