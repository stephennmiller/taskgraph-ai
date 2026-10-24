/**
 * The tables `npm run evals` prints:
 *
 *   Plan evals · 6 samples · sonnet
 *   sample            tasks  subtasks  checks  judge   tokens   secs
 *   cli-notes             5        14    0.92   0.75    41.2k     83
 *   all                  58       201    0.88   0.71     512k    934
 *   Task count follows PRD size: 0.94
 *
 *   Change from baseline (2026-10-20, 1a2b3c4)
 *   sample            tasks  checks   judge   tokens    secs
 *   cli-notes            +1   -0.02   +0.04    -3.1k     -12
 */

import {
	type EvalChange,
	type EvalDiff,
	type EvalRun,
	type EvalSampleResult,
	sampleSeconds,
	sampleTokens
} from '@tm/core';

const pad = (text: string, width: number) => text.padStart(width);
const SAMPLE_WIDTH = 16;

function compact(n: number): string {
	if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (Math.abs(n) >= 10_000) return `${Math.round(n / 1000)}k`;
	if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(1)}k`;
	return String(Math.round(n));
}

const score = (n: number | null | undefined) =>
	n === null || n === undefined ? '-' : n.toFixed(2);

function row(cells: string[], widths: number[]): string {
	return cells
		.map((cell, i) =>
			i === 0
				? cell.slice(0, SAMPLE_WIDTH).padEnd(SAMPLE_WIDTH)
				: pad(cell, widths[i])
		)
		.join('');
}

export function formatRun(run: EvalRun): string {
	const widths = [SAMPLE_WIDTH, 7, 10, 8, 7, 9, 7];
	const models = [
		...new Set(run.samples.flatMap((s) => s.calls.map((c) => c.model)))
	].filter(Boolean);
	const lines = [
		`Plan evals · ${run.samples.length} samples${models.length ? ` · ${models.join(', ')}` : ''}`,
		row(
			['sample', 'tasks', 'subtasks', 'checks', 'judge', 'tokens', 'secs'],
			widths
		)
	];
	for (const s of run.samples) {
		lines.push(
			row(
				[
					s.id,
					String(s.taskCount),
					String(s.subtaskCount),
					score(s.checkScore),
					score(s.judge?.score),
					compact(sampleTokens(s)),
					compact(sampleSeconds(s))
				],
				widths
			)
		);
	}
	const { summary } = run;
	lines.push(
		row(
			[
				'all',
				String(summary.taskCount),
				String(summary.subtaskCount),
				score(summary.checkScore),
				score(summary.judgeScore),
				compact(summary.inputTokens + summary.outputTokens),
				compact(summary.seconds)
			],
			widths
		),
		`Task count follows PRD size: ${score(summary.taskScaling.correlation)}`
	);
	const problems = run.samples.flatMap(problemLines);
	if (problems.length > 0) lines.push('', ...problems);
	return lines.join('\n');
}

/** What cost a sample points, one line each */
function problemLines(s: EvalSampleResult): string[] {
	if (s.error) return [`${s.id}: failed: ${s.error}`];
	if (!s.checks) return [];
	const { headingCoverage, dependencies, acceptanceCriteria } = s.checks;
	const lines: string[] = [];
	if (!s.judge && s.calls.some((c) => c.command === 'judge')) {
		lines.push(`${s.id}: the judge didn't grade every rubric item`);
	}
	const list = (items: string[]) =>
		items.length > 3
			? `${items.slice(0, 3).join(', ')} and ${items.length - 3} more`
			: items.join(', ');
	if (headingCoverage.uncovered.length > 0) {
		lines.push(`${s.id}: no task for ${list(headingCoverage.uncovered)}`);
	}
	if (dependencies.cycles.length > 0) {
		lines.push(
			`${s.id}: dependency cycle ${dependencies.cycles.map((c) => c.join(' → ')).join('; ')}`
		);
	}
	if (dependencies.invalid.length > 0) {
		lines.push(
			`${s.id}: bad dependencies ${list(dependencies.invalid.map((d) => `${d.id} → ${d.dependency} (${d.reason})`))}`
		);
	}
	if (acceptanceCriteria.missing.length > 0) {
		lines.push(
			`${s.id}: no acceptance criteria on ${list(acceptanceCriteria.missing)}`
		);
	}
	return lines;
}

function signed(change: EvalChange, format: (n: number) => string): string {
	if (change.delta === null) return change.current === null ? '-' : 'new';
	const size = format(Math.abs(change.delta));
	if (Number(size) === 0) return '0';
	return `${change.delta > 0 ? '+' : '-'}${size}`;
}

export function formatDiff(diff: EvalDiff, baseline: EvalRun): string {
	const widths = [SAMPLE_WIDTH, 7, 8, 8, 9, 8];
	const lines = [
		`Change from baseline (${baseline.date.slice(0, 10)}${baseline.commit ? `, ${baseline.commit}` : ''})`,
		row(['sample', 'tasks', 'checks', 'judge', 'tokens', 'secs'], widths)
	];
	for (const r of diff.rows) {
		lines.push(
			row(
				[
					r.id,
					signed(r.taskCount, String),
					signed(r.checkScore, (n) => n.toFixed(2)),
					signed(r.judgeScore, (n) => n.toFixed(2)),
					signed(r.tokens, compact),
					signed(r.seconds, compact)
				],
				widths
			)
		);
	}
	lines.push(
		`Task count follows PRD size: ${signed(diff.taskScaling, (n) => n.toFixed(2))}`
	);
	if (diff.removed.length > 0) {
		lines.push(`Not run this time: ${diff.removed.join(', ')}`);
	}
	return lines.join('\n');
}
