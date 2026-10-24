/**
 * @fileoverview What `analyze-complexity` found and what `complexity-report`
 * shows, e.g.
 *
 *   ✓ Analyzed 5 tasks · skipped 1 done
 *     3  Email and password sign-in with sessions   ● 7  6 subtasks
 *     4  Bookmark CRUD endpoints                    ● 6  5 subtasks
 *     6  Write the README                           ● 2
 *   Saved to .taskgraph/reports/task-complexity-report.json
 *   Next: taskgraph expand --all, or taskgraph complexity-report to see why
 *
 * They replace progress logs with absolute paths (two of them printed twice),
 * a dashed summary, a boxed next-steps list, and a report table that put each
 * task's whole expansion prompt in a 22-column cell.
 */

import { sanitizeForTerminal } from '@tm/core';
import chalk from 'chalk';
import { terminalWidth } from '../layout/helpers.js';
import { theme } from '../theme.js';
import {
	complexityLevel,
	getComplexityWithColor
} from './complexity-formatters.js';

/** One task's entry in task-complexity-report.json */
export interface ComplexityAnalysisItem {
	taskId: number | string;
	taskTitle: string;
	complexityScore: number;
	recommendedSubtasks?: number;
	expansionPrompt?: string;
	reasoning?: string;
	/** A default for a task the AI left out, not a score */
	placeholder?: true;
}

/** task-complexity-report.json */
export interface ComplexityReport {
	meta: {
		generatedAt: string;
		tasksAnalyzed?: number;
		thresholdScore?: number;
		usedResearch?: boolean;
	};
	complexityAnalysis: ComplexityAnalysisItem[];
}

export interface ComplexityRunSummary {
	/** The analyses from this run */
	analyses: ComplexityAnalysisItem[];
	/** Done, cancelled or deferred tasks left out */
	skipped: number;
	/** Analyses from earlier runs that the report keeps */
	kept: number;
	/** The report file, relative to the project */
	reportPath: string;
	usedResearch?: boolean;
}

const plural = (count: number, noun: string) =>
	`${count} ${count === 1 ? noun : `${noun}s`}`;

const fit = (text: string, width: number) =>
	text.length > width ? `${text.slice(0, Math.max(1, width - 1))}…` : text;

const byScore = (items: ComplexityAnalysisItem[]) =>
	[...items].sort((a, b) => b.complexityScore - a.complexityScore);

/** Wrap text to a width, breaking at spaces */
function wrap(text: string, width: number): string[] {
	const lines: string[] = [];
	let line = '';
	for (const word of text.split(/\s+/).filter(Boolean)) {
		if (line && line.length + 1 + word.length > width) {
			lines.push(line);
			line = word;
		} else {
			line = line ? `${line} ${word}` : word;
		}
	}
	if (line) lines.push(line);
	return lines;
}

/**
 * One aligned row per task, highest score first:
 * `  3  Email and password sign-in…  ● 7  6 subtasks`
 */
function taskRows(items: ComplexityAnalysisItem[], width: number) {
	const sorted = byScore(items);
	const idWidth = Math.max(...sorted.map((item) => String(item.taskId).length));
	const scoreWidth = Math.max(
		...sorted.map((item) => String(item.complexityScore).length)
	);
	const countLabel = (item: ComplexityAnalysisItem) =>
		item.recommendedSubtasks ? plural(item.recommendedSubtasks, 'subtask') : '';
	const countWidth = Math.max(
		0,
		...sorted.map((item) => countLabel(item).length)
	);
	// indent, ID, gap, title, gap, "● N", gap, count
	const titleWidth = Math.max(
		12,
		Math.min(
			Math.max(...sorted.map((item) => item.taskTitle.length)),
			width -
				2 -
				idWidth -
				2 -
				2 -
				(scoreWidth + 2) -
				(countWidth ? countWidth + 2 : 0)
		)
	);

	return sorted.map((item) => {
		const title = fit(item.taskTitle, titleWidth).padEnd(titleWidth);
		const score = getComplexityWithColor(item.complexityScore);
		const pad = ' '.repeat(scoreWidth - String(item.complexityScore).length);
		const count = countLabel(item);
		return {
			item,
			line: `  ${theme.brand(String(item.taskId).padEnd(idWidth))}  ${title}  ${score}${pad}${count ? `  ${theme.muted(count)}` : ''}`.trimEnd(),
			indent: 2 + idWidth + 2
		};
	});
}

/** `High 1 · Medium 3 · Low 1` */
function levelCounts(items: ComplexityAnalysisItem[]): string {
	const counts = { High: 0, Medium: 0, Low: 0 };
	for (const item of items) counts[complexityLevel(item.complexityScore)]++;
	return `High ${counts.High} · Medium ${counts.Medium} · Low ${counts.Low}`;
}

const expandHint = () =>
	theme.muted('Run ') +
	theme.brand('taskgraph expand --id=<id>') +
	theme.muted(' or ') +
	theme.brand('--all') +
	theme.muted(' to use these recommendations');

/**
 * Format the result of `analyze-complexity`.
 *
 * @param summary - What this run analyzed and where the report went
 * @param width - Terminal width; titles are cut to fit
 */
export function formatComplexityRun(
	summary: ComplexityRunSummary,
	width = terminalWidth()
): string {
	summary = sanitizeForTerminal(summary);
	const { skipped, kept, reportPath } = summary;
	if (summary.analyses.length === 0) {
		return theme.muted('No pending tasks to analyze');
	}
	// A placeholder isn't a score; the "Missing analysis" warning names its task
	const analyses = summary.analyses.filter((item) => !item.placeholder);

	const details = [
		summary.usedResearch ? 'with web research' : null,
		skipped > 0 ? `skipped ${skipped} done` : null
	].filter(Boolean);
	const lines = [
		`${chalk.green('✓')} Analyzed ${plural(analyses.length, 'task')}${details.length ? theme.muted(` · ${details.join(' · ')}`) : ''}`,
		...taskRows(analyses, width).map((row) => row.line)
	];

	const earlier =
		kept === 0
			? ''
			: `, with ${kept} earlier ${kept === 1 ? 'analysis' : 'analyses'}`;
	lines.push(theme.muted(`Saved to ${reportPath}${earlier}`));
	lines.push(
		theme.muted('Next: ') +
			theme.brand('taskgraph expand --all') +
			theme.muted(', or ') +
			theme.brand('taskgraph complexity-report') +
			theme.muted(' to see why')
	);
	return lines.join('\n');
}

/**
 * Format `task-complexity-report.json` for `complexity-report`: a heading,
 * then each task with its score, recommended subtasks and the reasoning.
 *
 * @param report - The parsed report
 * @param width - Terminal width; text wraps to fit
 */
export function formatComplexityReport(
	report: ComplexityReport,
	width = terminalWidth()
): string {
	report = sanitizeForTerminal(report);
	const items = report.complexityAnalysis ?? [];
	if (items.length === 0) {
		return theme.muted('The report has no analyzed tasks yet');
	}

	const generated = new Date(report.meta.generatedAt);
	const when = Number.isNaN(generated.getTime())
		? null
		: generated.toLocaleString(undefined, {
				month: 'short',
				day: 'numeric',
				hour: 'numeric',
				minute: '2-digit'
			});
	const header = [
		plural(items.length, 'task'),
		levelCounts(items),
		report.meta.usedResearch ? 'with web research' : null,
		when
	]
		.filter(Boolean)
		.join(' · ');

	const lines = [theme.heading('Complexity report'), theme.muted(header), ''];
	for (const row of taskRows(items, width)) {
		lines.push(row.line);
		if (row.item.reasoning) {
			const pad = ' '.repeat(row.indent);
			for (const text of wrap(
				row.item.reasoning,
				Math.max(20, width - row.indent)
			)) {
				lines.push(theme.muted(`${pad}${text}`));
			}
		}
		lines.push('');
	}
	lines.push(expandHint());
	return lines.join('\n');
}
