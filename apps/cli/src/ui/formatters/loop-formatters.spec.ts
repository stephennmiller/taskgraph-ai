/**
 * @fileoverview Tests for what `loop` prints: before it starts, around each
 * iteration, and at the end
 */

import { stripVTControlCharacters } from 'node:util';
import type { LoopResult } from '@tm/core';
import { describe, expect, it } from 'vitest';
import {
	type LoopIntro,
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
});
