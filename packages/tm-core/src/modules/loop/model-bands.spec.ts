/**
 * @fileoverview Picking an iteration's model and effort from the task's
 * complexity score (#838)
 */

import { describe, expect, it } from 'vitest';
import {
	DEFAULT_LOOP_BANDS,
	modelArgs,
	parseLoopModel,
	pickModelEffort,
	resolveLoopBands
} from './model-bands.js';

describe('pickModelEffort', () => {
	it.each([
		[1, { model: 'sonnet', effort: 'low' }],
		[3, { model: 'sonnet', effort: 'low' }],
		[4, { effort: 'medium' }],
		[6, { effort: 'medium' }],
		[7, { effort: 'high' }],
		[10, { effort: 'high' }]
	])('puts score %d in its default band', (score, choice) => {
		expect(pickModelEffort(score, DEFAULT_LOOP_BANDS)).toEqual(choice);
	});

	it.each([undefined, null, 'complex', Number.NaN, 11])(
		"leaves Claude Code's defaults for a task without a usable score (%s)",
		(score) => {
			expect(pickModelEffort(score, DEFAULT_LOOP_BANDS)).toEqual({});
		}
	);

	it('picks nothing when there are no bands', () => {
		expect(pickModelEffort(2, [])).toEqual({});
	});

	it("lets --model replace the band's model but keeps its effort", () => {
		expect(pickModelEffort(2, DEFAULT_LOOP_BANDS, 'opus')).toEqual({
			model: 'opus',
			effort: 'low'
		});
		expect(pickModelEffort(9, DEFAULT_LOOP_BANDS, 'opus')).toEqual({
			model: 'opus',
			effort: 'high'
		});
		expect(pickModelEffort(undefined, DEFAULT_LOOP_BANDS, 'opus')).toEqual({
			model: 'opus'
		});
	});
});

describe('modelArgs', () => {
	it('turns a choice into claude flags', () => {
		expect(modelArgs({ model: 'sonnet', effort: 'low' })).toEqual([
			'--model',
			'sonnet',
			'--effort',
			'low'
		]);
		expect(modelArgs({})).toEqual([]);
	});
});

describe('resolveLoopBands', () => {
	it('uses the defaults when the config sets no bands', () => {
		expect(resolveLoopBands(undefined)).toBe(DEFAULT_LOOP_BANDS);
		expect(resolveLoopBands({})).toBe(DEFAULT_LOOP_BANDS);
	});

	it('takes the configured bands, sorted by maxScore', () => {
		expect(
			resolveLoopBands({
				bands: [
					{ maxScore: 10, model: 'opus', effort: 'max' },
					{ maxScore: 5, model: 'claude-haiku-4-5' }
				]
			})
		).toEqual([
			{ maxScore: 5, model: 'claude-haiku-4-5' },
			{ maxScore: 10, model: 'opus', effort: 'max' }
		]);
		expect(resolveLoopBands({ bands: [] })).toEqual([]);
	});

	it.each([
		[{ bands: 'fast' }, 'must be a list'],
		[{ bands: [{ model: 'opus' }] }, 'band 1 needs a number for maxScore'],
		[{ bands: [{ maxScore: 3, model: '--help' }] }, "isn't a model name"],
		[{ bands: [{ maxScore: 3, effort: 'huge' }] }, 'effort "huge"']
	])('refuses %j', (loop, message) => {
		expect(() => resolveLoopBands(loop)).toThrow(message);
	});
});

describe('parseLoopModel', () => {
	it('takes aliases and full model names', () => {
		expect(parseLoopModel(' opus ')).toBe('opus');
		expect(parseLoopModel('claude-opus-4-5[1m]')).toBe('claude-opus-4-5[1m]');
		expect(parseLoopModel(undefined)).toBeUndefined();
	});

	it.each(['', '--dangerously-skip-permissions', 'opus; rm -rf /'])(
		'refuses %j',
		(value) => {
			expect(() => parseLoopModel(value)).toThrow('--model');
		}
	);
});
