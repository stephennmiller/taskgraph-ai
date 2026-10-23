/**
 * @fileoverview Tests for what `loop` prints before it starts
 */

import { stripVTControlCharacters } from 'node:util';
import { describe, expect, it } from 'vitest';
import {
	type LoopIntro,
	formatLoopIntro,
	formatStartDeprecation
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

describe('formatStartDeprecation', () => {
	it('names the loop command that replaces start', () => {
		expect(stripVTControlCharacters(formatStartDeprecation('3'))).toBe(
			'start is deprecated; run taskgraph loop -n 1 --id 3 instead'
		);
	});

	it('drops --id when no task was given', () => {
		expect(stripVTControlCharacters(formatStartDeprecation())).toBe(
			'start is deprecated; run taskgraph loop -n 1 instead'
		);
	});
});
