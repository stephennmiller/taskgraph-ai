/**
 * @fileoverview The record of one `npm run evals` run, its summary, and the
 * change from a baseline run.
 */

import {
	type PlanChecks,
	type TaskScalingCheck,
	checkTaskScaling
} from './plan-checks.js';
import type { JudgeScore } from './plan-judge.js';

/** Bump when a key a reader relies on changes meaning */
export const EVAL_RUN_SCHEMA_VERSION = 1;

/** One model call the run made */
export interface EvalCall {
	command: 'parse-prd' | 'analyze-complexity' | 'expand' | 'judge';
	/** The task expand ran on */
	taskId?: string;
	seconds: number;
	inputTokens: number;
	outputTokens: number;
	/** Part of inputTokens read from the prompt cache */
	cachedInputTokens?: number;
	model?: string;
	/** The provider reported no usage, so the token counts read 0 */
	usageMissing?: boolean;
}

/** What one sample PRD produced and how it scored */
export interface EvalSampleResult {
	id: string;
	kind: string;
	words: number;
	sections: number;
	taskCount: number;
	subtaskCount: number;
	/** Mean of the deterministic checks; null when the plan wasn't made or an error cut it short */
	checkScore: number | null;
	checks: PlanChecks | null;
	/** Null when the judge wasn't run or its answer was unusable */
	judge: JudgeScore | null;
	calls: EvalCall[];
	/** Why the sample stopped early */
	error?: string;
}

export interface EvalSummary {
	/** Mean check score over the samples that produced a plan */
	checkScore: number | null;
	/** Mean judge score over the samples the judge graded */
	judgeScore: number | null;
	taskScaling: TaskScalingCheck;
	taskCount: number;
	subtaskCount: number;
	failed: number;
	calls: number;
	seconds: number;
	inputTokens: number;
	outputTokens: number;
}

export interface EvalRun {
	schemaVersion: number;
	/** ISO timestamp of the run's start */
	date: string;
	commit?: string;
	samples: EvalSampleResult[];
	summary: EvalSummary;
}

function mean(values: Array<number | null>): number | null {
	const present = values.filter((v): v is number => v !== null);
	return present.length === 0
		? null
		: present.reduce((sum, v) => sum + v, 0) / present.length;
}

/** Tokens in and out over a sample's calls */
export const sampleTokens = (s: EvalSampleResult): number =>
	s.calls.reduce((sum, c) => sum + c.inputTokens + c.outputTokens, 0);

/** Seconds over a sample's calls */
export const sampleSeconds = (s: EvalSampleResult): number =>
	s.calls.reduce((sum, c) => sum + c.seconds, 0);

export function summarizeEvalRun(samples: EvalSampleResult[]): EvalSummary {
	const calls = samples.flatMap((s) => s.calls);
	const planned = samples.filter((s) => s.checkScore !== null);
	return {
		checkScore: mean(samples.map((s) => s.checkScore)),
		judgeScore: mean(samples.map((s) => s.judge?.score ?? null)),
		taskScaling: checkTaskScaling(
			planned.map((s) => ({ id: s.id, words: s.words, taskCount: s.taskCount }))
		),
		taskCount: samples.reduce((sum, s) => sum + s.taskCount, 0),
		subtaskCount: samples.reduce((sum, s) => sum + s.subtaskCount, 0),
		failed: samples.filter((s) => s.error !== undefined).length,
		calls: calls.length,
		seconds: calls.reduce((sum, c) => sum + c.seconds, 0),
		inputTokens: calls.reduce((sum, c) => sum + c.inputTokens, 0),
		outputTokens: calls.reduce((sum, c) => sum + c.outputTokens, 0)
	};
}

/** A measure now, in the baseline, and the change (null when either is missing) */
export interface EvalChange {
	current: number | null;
	baseline: number | null;
	delta: number | null;
}

export interface EvalDiffRow {
	/** A sample ID, or `all` for the run's summary */
	id: string;
	checkScore: EvalChange;
	judgeScore: EvalChange;
	taskCount: EvalChange;
	tokens: EvalChange;
	seconds: EvalChange;
}

export interface EvalDiff {
	rows: EvalDiffRow[];
	taskScaling: EvalChange;
	/** Samples in this run but not the baseline, and the reverse */
	added: string[];
	removed: string[];
}

function change(
	current: number | null | undefined,
	baseline: number | null | undefined
): EvalChange {
	const c = current ?? null;
	const b = baseline ?? null;
	return {
		current: c,
		baseline: b,
		delta: c === null || b === null ? null : c - b
	};
}

/**
 * Each sample's change from the baseline, then the run's as `all`. When the
 * two runs hold different samples (a run with `--only`), `all` compares the
 * samples both have, so the totals don't move by the samples left out.
 */
export function diffEvalRuns(current: EvalRun, baseline: EvalRun): EvalDiff {
	const before = new Map(baseline.samples.map((s) => [s.id, s]));
	const ids = new Set(current.samples.map((s) => s.id));
	const rows: EvalDiffRow[] = current.samples.map((s) => {
		const b = before.get(s.id);
		return {
			id: s.id,
			checkScore: change(s.checkScore, b?.checkScore),
			judgeScore: change(s.judge?.score, b?.judge?.score),
			taskCount: change(s.taskCount, b?.taskCount),
			tokens: change(sampleTokens(s), b ? sampleTokens(b) : null),
			seconds: change(sampleSeconds(s), b ? sampleSeconds(b) : null)
		};
	});
	const sameSamples =
		ids.size === before.size && [...ids].every((id) => before.has(id));
	const now = sameSamples
		? current.summary
		: summarizeEvalRun(current.samples.filter((s) => before.has(s.id)));
	const then = sameSamples
		? baseline.summary
		: summarizeEvalRun(baseline.samples.filter((s) => ids.has(s.id)));
	rows.push({
		id: 'all',
		checkScore: change(now.checkScore, then.checkScore),
		judgeScore: change(now.judgeScore, then.judgeScore),
		taskCount: change(now.taskCount, then.taskCount),
		tokens: change(
			now.inputTokens + now.outputTokens,
			then.inputTokens + then.outputTokens
		),
		seconds: change(now.seconds, then.seconds)
	});
	return {
		rows,
		taskScaling: change(
			now.taskScaling.correlation,
			then.taskScaling.correlation
		),
		added: current.samples.filter((s) => !before.has(s.id)).map((s) => s.id),
		removed: baseline.samples.filter((s) => !ids.has(s.id)).map((s) => s.id)
	};
}
