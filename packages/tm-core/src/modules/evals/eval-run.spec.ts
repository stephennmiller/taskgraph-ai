import { describe, expect, it } from 'vitest';
import {
	EVAL_RUN_SCHEMA_VERSION,
	type EvalCall,
	type EvalRun,
	type EvalSampleResult,
	diffEvalRuns,
	summarizeEvalRun
} from './eval-run.js';

const call = (
	command: EvalCall['command'],
	tokens: [number, number],
	seconds: number
): EvalCall => ({
	command,
	inputTokens: tokens[0],
	outputTokens: tokens[1],
	seconds
});

const sample = (
	id: string,
	overrides: Partial<EvalSampleResult> = {}
): EvalSampleResult => ({
	id,
	kind: 'one-pager',
	words: 100,
	sections: 3,
	taskCount: 4,
	subtaskCount: 10,
	checkScore: 0.8,
	checks: null,
	judge: { score: 0.5, grades: {}, summary: '' },
	calls: [call('parse-prd', [1000, 200], 10), call('judge', [500, 100], 5)],
	...overrides
});

const run = (samples: EvalSampleResult[]): EvalRun => ({
	schemaVersion: EVAL_RUN_SCHEMA_VERSION,
	date: '2026-10-23T00:00:00.000Z',
	samples,
	summary: summarizeEvalRun(samples)
});

describe('summarizeEvalRun', () => {
	it('totals calls and averages scores over the samples that have one', () => {
		const summary = summarizeEvalRun([
			sample('a', { checkScore: 1, words: 100, taskCount: 3 }),
			sample('b', { checkScore: 0.5, words: 300, taskCount: 6 }),
			sample('c', { judge: null, words: 900, taskCount: 12 }),
			sample('d', {
				checkScore: null,
				judge: null,
				calls: [],
				error: 'parse-prd failed'
			})
		]);

		expect(summary.checkScore).toBeCloseTo((1 + 0.5 + 0.8) / 3);
		expect(summary.judgeScore).toBe(0.5);
		expect(summary.failed).toBe(1);
		expect(summary.taskCount).toBe(25);
		expect(summary.subtaskCount).toBe(40);
		expect(summary.calls).toBe(6);
		expect(summary.seconds).toBe(45);
		expect(summary.inputTokens).toBe(4500);
		expect(summary.outputTokens).toBe(900);
		// The failed sample made no plan, so it doesn't count toward scaling
		expect(summary.taskScaling.samples.map((s) => s.id)).toEqual([
			'a',
			'b',
			'c'
		]);
		expect(summary.taskScaling.score).toBeCloseTo(1);
	});

	it('has no scores when nothing was planned', () => {
		const summary = summarizeEvalRun([]);

		expect(summary.checkScore).toBeNull();
		expect(summary.judgeScore).toBeNull();
		expect(summary.taskScaling.score).toBeNull();
	});
});

describe('diffEvalRuns', () => {
	it('gives each sample and the run its change from the baseline', () => {
		const baseline = run([sample('a'), sample('gone')]);
		const current = run([
			sample('a', {
				checkScore: 0.9,
				taskCount: 6,
				calls: [call('parse-prd', [800, 200], 8)]
			}),
			sample('new')
		]);

		const diff = diffEvalRuns(current, baseline);

		const [a, added, all] = diff.rows;
		expect(a.id).toBe('a');
		expect(a.checkScore.delta).toBeCloseTo(0.1);
		expect(a.taskCount).toEqual({ current: 6, baseline: 4, delta: 2 });
		expect(a.tokens).toEqual({ current: 1000, baseline: 1800, delta: -800 });
		expect(a.seconds).toEqual({ current: 8, baseline: 15, delta: -7 });
		expect(added.checkScore).toEqual({
			current: 0.8,
			baseline: null,
			delta: null
		});
		expect(all.id).toBe('all');
		expect(all.taskCount).toEqual({ current: 10, baseline: 8, delta: 2 });
		expect(diff.added).toEqual(['new']);
		expect(diff.removed).toEqual(['gone']);
	});

	it('has no judge change when either run lacks a judge score', () => {
		const diff = diffEvalRuns(
			run([sample('a', { judge: null })]),
			run([sample('a')])
		);

		expect(diff.rows[0].judgeScore).toEqual({
			current: null,
			baseline: 0.5,
			delta: null
		});
	});
});
