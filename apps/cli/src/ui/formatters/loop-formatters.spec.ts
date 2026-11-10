/**
 * @fileoverview Tests for what `loop` prints: before it starts, around each
 * iteration, and at the end
 */

import { stripVTControlCharacters } from 'node:util';
import type { LoopPlan, LoopResult } from '@tm/core';
import { describe, expect, it } from 'vitest';
import {
	type LoopIntro,
	formatLoopDryRun,
	formatLoopIntro,
	formatLoopIterationEnd,
	formatLoopIterationStart,
	formatLoopMessage,
	formatLoopSummary,
	formatSandboxAuth
} from './loop-formatters.js';

const intro = (overrides: Partial<LoopIntro> = {}): LoopIntro => ({
	prompt: 'default',
	isPreset: true,
	iterations: 5,
	sandbox: false,
	...overrides
});

const plain = (lines: string[]) => lines.map(stripVTControlCharacters);

describe('formatLoopIntro', () => {
	it('says the preset, the iteration cap and the mode on one line', () => {
		expect(plain(formatLoopIntro(intro()))).toEqual([
			'Loop · default preset · up to 5 iterations · Claude CLI'
		]);
	});

	it('names a pinned task', () => {
		expect(
			plain(
				formatLoopIntro(
					intro({
						prompt: 'tdd',
						iterations: 1,
						pinned: { id: '3', title: 'Set up the database schema' }
					})
				)
			)
		).toEqual([
			'Loop · tdd preset · 1 iteration · Claude CLI',
			'Task 3  Set up the database schema'
		]);
	});

	it('names the task the run starts with', () => {
		expect(
			plain(
				formatLoopIntro(intro({ next: { id: '1.2', title: 'Users table' } }))
			)[1]
		).toBe('Starts with task 1.2  Users table');
	});

	it('prints a task ID from tasks.json without its escape sequences', () => {
		const [, line] = formatLoopIntro(
			intro({ next: { id: '4\x1b[2J', title: 'Clear' } })
		);
		expect(line).not.toContain('\x1b[2J');
		expect(stripVTControlCharacters(line)).toBe('Starts with task 4  Clear');
	});

	it('says when no task is ready', () => {
		expect(plain(formatLoopIntro(intro({ next: null })))[1]).toBe(
			'No task is ready to work on'
		);
	});

	it('names a custom prompt file and the sandbox', () => {
		expect(
			plain(
				formatLoopIntro(
					intro({ prompt: './my-loop.md', isPreset: false, sandbox: true })
				)
			)[0]
		).toBe('Loop · prompt ./my-loop.md · up to 5 iterations · Docker sandbox');
	});

	it('fits long titles and prompt paths to the width', () => {
		const lines = plain(
			formatLoopIntro(
				intro({
					prompt: `./${'deep/'.repeat(20)}prompt.md`,
					isPreset: false,
					pinned: { id: '12', title: 'A very long title '.repeat(10) }
				}),
				60
			)
		);
		for (const line of lines) expect(line.length).toBeLessThanOrEqual(60);
		expect(lines[1].endsWith('…')).toBe(true);
	});
});

describe('formatLoopIterationStart', () => {
	it('is one line with the count, and the task when --id pinned one', () => {
		expect(stripVTControlCharacters(formatLoopIterationStart(1, 5))).toBe(
			'Iteration 1 of 5'
		);
		expect(
			stripVTControlCharacters(formatLoopIterationStart(2, 5, '3.2\x1b[2J'))
		).toBe('Iteration 2 of 5 · task 3.2');
	});
});

describe('formatLoopIterationEnd', () => {
	const end = (...args: Parameters<typeof formatLoopIterationEnd>) =>
		stripVTControlCharacters(formatLoopIterationEnd(...args));

	it('leads with ✓ and carries what it ran at and spent', () => {
		expect(
			end({
				iteration: 1,
				status: 'success',
				model: 'sonnet',
				effort: 'low',
				costUsd: 0.42,
				turns: 12,
				duration: 190_000
			})
		).toBe('✓ Iteration 1 · sonnet, low effort · $0.42 · 12 turns · 3m 10s');
		expect(end({ iteration: 4, status: 'complete', message: 'done' })).toBe(
			'✓ Iteration 4'
		);
	});

	it('says why it failed or was blocked, unless that was already printed', () => {
		const failed = {
			iteration: 2,
			status: 'error' as const,
			message: 'Claude Code reached the --max-turns limit',
			costUsd: 0.2,
			turns: 5
		};
		expect(end(failed)).toBe(
			'✗ Iteration 2 failed: Claude Code reached the --max-turns limit · $0.2 · 5 turns'
		);
		expect(end(failed, failed.message)).toBe(
			'✗ Iteration 2 failed · $0.2 · 5 turns'
		);
		expect(
			end({ iteration: 3, status: 'blocked', message: 'Needs an API key' })
		).toBe('■ Iteration 3 blocked: Needs an API key');
	});

	it("drops escape sequences from Claude's reason", () => {
		expect(
			formatLoopIterationEnd({
				iteration: 1,
				status: 'blocked',
				message: 'stuck\x1b]0;pwned\x07'
			})
		).not.toContain('\x1b]0;');
	});
});

describe('formatLoopMessage', () => {
	it('prints errors after ✗ and warnings plain, without escape sequences', () => {
		expect(stripVTControlCharacters(formatLoopMessage('Task 4 is stuck'))).toBe(
			'✗ Task 4 is stuck'
		);
		const warning = formatLoopMessage('Task 4\x1b[2J is ready', 'warning');
		expect(warning).not.toContain('\x1b[2J');
		expect(stripVTControlCharacters(warning)).toBe('Task 4 is ready');
	});
});

describe('long messages', () => {
	it('wrap at spaces to the width, with a hanging indent', () => {
		const stuck =
			'Task 4 is stuck: no task changed status and nothing was committed in 2 iterations in a row. Check the progress file and the task, then run loop again.';
		const lines = stripVTControlCharacters(
			formatLoopMessage(stuck, 'error', 60)
		).split('\n');
		expect(lines.length).toBeGreaterThan(1);
		for (const line of lines) expect(line.length).toBeLessThanOrEqual(60);
		expect(lines[1].startsWith('  ')).toBe(true);
		expect(lines.join(' ').replace(/ +/g, ' ')).toBe(`✗ ${stuck}`);

		const end = stripVTControlCharacters(
			formatLoopIterationEnd(
				{ iteration: 1, status: 'error', message: stuck, costUsd: 0.2 },
				undefined,
				80
			)
		);
		for (const line of end.split('\n'))
			expect(line.length).toBeLessThanOrEqual(80);
	});
});

describe('spend facts', () => {
	it('wrap between facts, never inside one', () => {
		const line = stripVTControlCharacters(
			formatLoopSummary(
				{
					iterations: [],
					totalIterations: 4,
					tasksCompleted: 4,
					finalStatus: 'all_complete',
					totalCostUsd: 1.35,
					totalTurns: 22,
					totalDurationMs: 104_000
				},
				new Set(),
				80
			)
		);
		expect(line).toBe(
			'✓ All tasks complete · 4 tasks completed in 4 iterations · $1.35 · 22 turns\n  · 1m 44s'
		);
		expect(line).not.toContain('\u00a0');
	});
});

describe('formatSandboxAuth', () => {
	it('says what to do, then that it worked', () => {
		expect(stripVTControlCharacters(formatSandboxAuth(false))).toBe(
			'Sign in to the sandbox, then press Ctrl+C to continue'
		);
		expect(stripVTControlCharacters(formatSandboxAuth(true))).toBe(
			'✓ Signed in to the sandbox'
		);
	});
});

describe('formatLoopSummary', () => {
	const summary = (fields: Partial<LoopResult>, shown?: Set<string>) =>
		stripVTControlCharacters(
			formatLoopSummary(
				{
					iterations: [],
					totalIterations: 4,
					tasksCompleted: 3,
					finalStatus: 'all_complete',
					...fields
				},
				shown
			)
		);

	it('is one line that leads with the outcome and carries the spend', () => {
		const lines = [
			summary({ totalCostUsd: 1.42, totalTurns: 61 }),
			summary({ totalCostUsd: 1.5, totalTurns: 9, totalDurationMs: 2_820_000 }),
			summary({ finalStatus: 'max_iterations', tasksCompleted: 1 }),
			summary({
				finalStatus: 'budget_reached',
				totalIterations: 1,
				totalCostUsd: 5,
				costPartial: true
			}),
			summary({ finalStatus: 'blocked', tasksCompleted: 0 })
		];
		expect(lines).toEqual([
			'✓ All tasks complete · 3 tasks completed in 4 iterations · $1.42 · 61 turns',
			'✓ All tasks complete · 3 tasks completed in 4 iterations · $1.50 · 9 turns · 47m',
			'Iteration limit reached · 1 task completed in 4 iterations',
			'--max-budget-usd reached · 3 tasks completed in 1 iteration · at least $5.00',
			'✗ Blocked · 0 tasks completed in 4 iterations'
		]);
		for (const line of lines) {
			expect(line).not.toContain('\n');
			expect(line.length).toBeLessThanOrEqual(80);
		}
	});

	it('names the error only when the run has not already printed it', () => {
		const error = {
			finalStatus: 'error' as const,
			errorMessage: "Claude Code isn't installed"
		};
		expect(summary(error)).toBe(
			"✗ Loop failed: Claude Code isn't installed · 3 tasks completed in 4 iterations"
		);
		expect(summary(error, new Set([error.errorMessage]))).toBe(
			'✗ Loop failed · 3 tasks completed in 4 iterations'
		);
	});

	it('lists the stuck tasks it set aside, with how to retry them, within 80 columns', () => {
		const one = summary({
			finalStatus: 'max_iterations',
			setAside: [{ id: '4', reason: 'stuck: no progress in 2 sessions' }]
		});
		const two = summary({
			finalStatus: 'max_iterations',
			setAside: [
				{ id: '4', reason: 'stuck: no progress in 2 sessions' },
				{ id: '7', reason: `stuck: ${'x'.repeat(200)}` }
			]
		});

		expect(one.split('\n')).toEqual([
			'Iteration limit reached · 3 tasks completed in 4 iterations',
			'Set aside 1 stuck task as blocked',
			'  4  stuck: no progress in 2 sessions',
			'Next: taskgraph show 4, then taskgraph set-status --id=4 --status=pending'
		]);
		expect(two).toContain('Set aside 2 stuck tasks as blocked');
		expect(two).toContain(
			'Next: taskgraph show <id>, then taskgraph set-status --id=<id> --status=pending'
		);
		for (const line of two.split('\n')) {
			expect(line.length).toBeLessThanOrEqual(80);
		}
	});
});

describe('formatLoopDryRun', () => {
	const plan = (overrides: Partial<LoopPlan> = {}): LoopPlan => ({
		prompt: 'default',
		iterations: 3,
		tag: 'master',
		tasks: [
			{
				id: '1',
				title: 'Set up the database schema',
				model: 'sonnet',
				effort: 'low'
			},
			{ id: '3.1', title: 'Add the session table' },
			{ id: '4', title: 'Build the login API', effort: 'high' }
		],
		picksOwnWork: false,
		...overrides
	});
	const options = { isPreset: true, sandbox: false };

	it('lists the tasks in order with the model and effort each runs at', () => {
		expect(plain(formatLoopDryRun(plan(), options))).toEqual([
			'Loop dry run · default preset · up to 3 iterations · Claude CLI',
			'  1    sonnet, low effort  Set up the database schema',
			'  3.1  default model       Add the session table',
			'  4    high effort         Build the login API',
			'Nothing started; run it without --dry-run'
		]);
	});

	it('says when no task is ready, and shows the smoke command', () => {
		const lines = plain(
			formatLoopDryRun(
				plan({ tasks: [], smokeCommand: 'npm run smoke' }),
				options
			)
		);
		expect(lines).toContain('No task is ready to work on');
		expect(lines).toContain('Smoke check  npm run smoke');
	});

	it('gives the model for a preset that picks its own work', () => {
		const lines = plain(
			formatLoopDryRun(
				plan({
					prompt: 'linting',
					tasks: [],
					picksOwnWork: true,
					model: 'opus'
				}),
				options
			)
		);
		expect(lines[1]).toBe('  Each iteration picks its own work · opus');
	});

	it('fits 80 columns and drops escape sequences from task text', () => {
		const raw = formatLoopDryRun(
			plan({
				tasks: [
					{ id: '2', title: `Build \x1b[31mit${' and more'.repeat(20)}` }
				],
				smokeCommand: `node cli.js ${'x'.repeat(100)}`
			}),
			options
		);
		const lines = plain(raw);
		for (const line of lines) expect(line.length).toBeLessThanOrEqual(80);
		expect(lines[1]).toMatch(
			/^ {2}2 {2}default model {2}Build it and more.*…$/
		);
		expect(raw[1]).not.toContain('\x1b[31mit');
	});
});
