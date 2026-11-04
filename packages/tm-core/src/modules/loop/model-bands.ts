/**
 * @fileoverview The model and effort each loop iteration runs at, picked
 * from the complexity score of the task it works on (#838). Scores come from
 * `analyze-complexity` (1-10). Bands live under `loop.bands` in
 * .taskgraph/config.json:
 *
 *   "loop": { "bands": [
 *     { "maxScore": 3, "model": "sonnet", "effort": "low" },
 *     { "maxScore": 6 },
 *     { "maxScore": 10, "effort": "high" }
 *   ] }
 *
 * A task scores into the first band whose maxScore it doesn't exceed. A band
 * without a model leaves Claude Code's own default model; a task without a
 * score, or past every band, runs as `claude -p` always has.
 */

import { LoopError } from './loop-task.js';

/** `claude --effort` levels (Claude Code 2.1) */
const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type LoopEffort = (typeof EFFORT_LEVELS)[number];

export interface LoopBand {
	/** Highest complexity score in the band */
	maxScore: number;
	/** `claude --model`: an alias (`sonnet`, `opus`) or a full model name */
	model?: string;
	/** `claude --effort` */
	effort?: LoopEffort;
}

/** What one iteration or parallel task runs at; empty means Claude Code's defaults */
export interface ModelChoice {
	model?: string;
	effort?: LoopEffort;
}

/**
 * Simple tasks on a cheaper model at low effort; hard ones at high effort.
 * 4-6 passes nothing: Claude Code's default effort is model-dependent
 * (high on most, xhigh on Opus 4.7) and `--effort` beats the user's
 * `effortLevel` setting, so a fixed `medium` would downgrade those tasks.
 */
export const DEFAULT_LOOP_BANDS: LoopBand[] = [
	{ maxScore: 3, model: 'sonnet', effort: 'low' },
	{ maxScore: 6 },
	{ maxScore: 10, effort: 'high' }
];

/** An alias or model name; never something `claude` would read as a flag */
const MODEL_NAME = /^[A-Za-z0-9][\w.:[\]-]*$/;

/**
 * Check `loop --model` before anything runs
 * @throws LoopError (with a hint) for a value that can't be a model name
 */
export function parseLoopModel(value: string | undefined): string | undefined {
	if (value === undefined) return undefined;
	const model = value.trim();
	if (!MODEL_NAME.test(model)) {
		throw new LoopError(
			`"${model}" isn't a model name for --model`,
			'Pass an alias or a full model name, e.g. `taskgraph loop --model opus`'
		);
	}
	return model;
}

/**
 * The bands from the project config's `loop` key, sorted by maxScore;
 * DEFAULT_LOOP_BANDS when it sets none. `"bands": []` turns picking off.
 * @throws LoopError (with a hint) for a band loop can't use
 */
export function resolveLoopBands(loop: unknown): LoopBand[] {
	const bands =
		loop && typeof loop === 'object'
			? (loop as { bands?: unknown }).bands
			: undefined;
	if (bands === undefined) return DEFAULT_LOOP_BANDS;
	const bad = (why: string) =>
		new LoopError(
			`loop.bands in .taskgraph/config.json${why}`,
			'Fix that band, or remove loop.bands to use the default bands'
		);
	if (!Array.isArray(bands)) throw bad(' must be a list of bands');
	const sorted = bands
		.map((band: unknown, i): LoopBand => {
			const { maxScore, model, effort } = (band ?? {}) as Record<
				string,
				unknown
			>;
			if (
				typeof maxScore !== 'number' ||
				!Number.isInteger(maxScore) ||
				maxScore < 1 ||
				maxScore > 10
			) {
				throw bad(
					`: band ${i + 1} needs a whole number from 1 to 10 for maxScore`
				);
			}
			if (
				model !== undefined &&
				(typeof model !== 'string' || !MODEL_NAME.test(model))
			) {
				throw bad(`: band ${i + 1} has a model that isn't a model name`);
			}
			if (
				effort !== undefined &&
				!EFFORT_LEVELS.includes(effort as LoopEffort)
			) {
				throw bad(
					`: band ${i + 1} has effort "${String(effort)}"; use ${EFFORT_LEVELS.join(', ')}`
				);
			}
			return {
				maxScore,
				...(model !== undefined ? { model: model as string } : {}),
				...(effort !== undefined ? { effort: effort as LoopEffort } : {})
			};
		})
		.sort((a, b) => a.maxScore - b.maxScore);
	// Two bands with one maxScore: the second could never be picked
	const dup = sorted.find(
		(b, i) => i > 0 && b.maxScore === sorted[i - 1].maxScore
	);
	if (dup) throw bad(`: two bands have maxScore ${dup.maxScore}`);
	return sorted;
}

/**
 * The model and effort for a task with this complexity score. `--model`
 * replaces the band's model; the band's effort still applies.
 */
export function pickModelEffort(
	score: unknown,
	bands: LoopBand[],
	modelOverride?: string
): ModelChoice {
	const band =
		typeof score === 'number' && Number.isFinite(score)
			? bands.find((b) => score <= b.maxScore)
			: undefined;
	const model = modelOverride ?? band?.model;
	return {
		...(model ? { model } : {}),
		...(band?.effort ? { effort: band.effort } : {})
	};
}

/** `claude -p` arguments for the choice */
export function modelArgs({ model, effort }: ModelChoice): string[] {
	return [
		...(model ? ['--model', model] : []),
		...(effort ? ['--effort', effort] : [])
	];
}
