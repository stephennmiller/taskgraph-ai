/**
 * @fileoverview What `taskgraph loop` prints. Before its first iteration:
 *
 *   Loop · tdd preset · up to 5 iterations · Claude CLI
 *   Starts with task 3  Set up the database schema
 *
 * a line at each iteration's start and end (Claude's output, unless
 * --no-output, goes between them):
 *
 *   Iteration 1 of 5
 *   ✓ Iteration 1 · sonnet, low effort · $0.42 · 12 turns · 3m 10s
 *   Iteration 2 of 5
 *   ✗ Iteration 2 failed: Claude Code reached the --max-turns limit · $0.2 · 5 turns
 *
 * and one line at the end:
 *
 *   ✓ All tasks complete · 3 tasks completed in 4 iterations · $1.42 · 61 turns
 */

import type { LoopIteration, LoopResult, LoopTask } from '@tm/core';
import chalk from 'chalk';
import { wrapLine } from '../layout/helpers.js';
import { theme } from '../theme.js';
import { terminalSafe } from './markdown-formatters.js';
import { fit, plural } from './parallel-loop-formatters.js';
import { formatLoopSpend } from './usage-formatters.js';

/** A line that can carry an error's text, wrapped at spaces with a hanging indent */
const wrap = (line: string, width: number) =>
	wrapLine(line, width, '  ').join('\n');

export interface LoopIntro {
	/** Preset name or custom prompt path */
	prompt: string;
	/** Whether `prompt` is a built-in preset */
	isPreset: boolean;
	iterations: number;
	sandbox: boolean;
	/** The task `--id` pinned */
	pinned?: LoopTask;
	/**
	 * The task `taskgraph next` would pick, for presets that work on tasks:
	 * null when none is ready, undefined for presets that pick their own work
	 */
	next?: LoopTask | null;
}

/** The lines `loop` prints before it starts Claude */
export function formatLoopIntro(intro: LoopIntro, width = 80): string[] {
	const prompt = intro.isPreset
		? `${intro.prompt} preset`
		: `prompt ${intro.prompt}`;
	const iterations =
		intro.iterations === 1
			? '1 iteration'
			: `up to ${intro.iterations} iterations`;
	const mode = intro.sandbox ? 'Docker sandbox' : 'Claude CLI';
	const facts = fit([prompt, iterations, mode].join(' · '), width - 7);
	const lines = [theme.text('Loop') + theme.muted(` · ${facts}`)];

	const task = intro.pinned ?? intro.next;
	if (task) {
		const label = intro.pinned ? 'Task' : 'Starts with task';
		const head = `${label} ${fit(task.id, 20)}  `;
		lines.push(theme.text(head + fit(task.title, width - head.length)));
	} else if (intro.next === null) {
		lines.push(chalk.yellow('No task is ready to work on'));
	}
	return lines;
}

/** The muted line an iteration starts with; names the task when `--id` pinned one */
export function formatLoopIterationStart(
	iteration: number,
	total: number,
	taskId?: string
): string {
	const task = taskId === undefined ? '' : ` · task ${fit(taskId, 20)}`;
	return theme.muted(`Iteration ${iteration} of ${total}${task}`);
}

const ITERATION_MARK: Record<LoopIteration['status'], string> = {
	success: chalk.green('✓'),
	complete: chalk.green('✓'),
	blocked: chalk.yellow('■'),
	error: chalk.red('✗')
};

/**
 * The line an iteration ends with: how it went, why when it failed or was
 * blocked, and what it ran at and spent.
 * @param shown - The reason already printed as it happened, not repeated here
 */
export function formatLoopIterationEnd(
	iteration: LoopIteration,
	shown?: string,
	width = 80
): string {
	const { status, message } = iteration;
	const word =
		status === 'error' ? ' failed' : status === 'blocked' ? ' blocked' : '';
	const why =
		word && message && message !== shown ? `: ${terminalSafe(message)}` : '';
	const color = status === 'error' ? chalk.red : theme.text;
	return wrap(
		`${ITERATION_MARK[status]} ${color(`Iteration ${iteration.iteration}${word}${why}`)}` +
			formatLoopSpend({
				session: iteration.session,
				model: iteration.model,
				effort: iteration.effort,
				costUsd: iteration.costUsd,
				costUnknown: iteration.costUnknown,
				turns: iteration.turns,
				durationMs: iteration.duration
			}),
		width
	);
}

/** An error or warning tm-core reported during the run (printed to stderr) */
export function formatLoopMessage(
	message: string,
	severity: 'warning' | 'error' = 'error',
	width = 80
): string {
	const text = terminalSafe(message);
	return wrap(
		severity === 'warning' ? chalk.yellow(text) : chalk.red(`✗ ${text}`),
		width
	);
}

/** The sandbox's sign-in step: before Claude's interactive session, and after it */
export function formatSandboxAuth(done: boolean): string {
	return done
		? `${chalk.green('✓')} Signed in to the sandbox`
		: chalk.yellow('Sign in to the sandbox, then press Ctrl+C to continue');
}

const STOP_REASON: Record<LoopResult['finalStatus'], string> = {
	all_complete: `${chalk.green('✓')} All tasks complete`,
	max_iterations: chalk.yellow('Iteration limit reached'),
	budget_reached: chalk.yellow('--max-budget-usd reached'),
	blocked: chalk.red('✗ Blocked'),
	error: chalk.red('✗ Loop failed')
};

/**
 * The run's one-line summary: why it stopped, the tasks it completed and
 * what it spent.
 * @param shown - Errors already printed during the run; result.errorMessage
 *   is added only when it isn't one of them
 */
export function formatLoopSummary(
	result: LoopResult,
	shown: ReadonlySet<string> = new Set(),
	width = 80
): string {
	const why =
		result.errorMessage && !shown.has(result.errorMessage)
			? chalk.red(`: ${terminalSafe(result.errorMessage)}`)
			: '';
	const counts = theme.muted(
		` · ${plural(result.tasksCompleted, 'task')} completed in ${plural(result.totalIterations, 'iteration')}`
	);
	return wrap(
		STOP_REASON[result.finalStatus] +
			why +
			counts +
			formatLoopSpend({
				costUsd: result.totalCostUsd,
				costPartial: result.costPartial,
				turns: result.totalTurns
			}),
		width
	);
}
