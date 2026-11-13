/**
 * @fileoverview What `taskgraph loop` prints. Before its first run in a
 * project (and `go` before its first step), unless --trust or --sandbox:
 *
 *   loop runs Claude Code with permission prompts off.
 *   It can read, edit and run anything in this project without asking.
 *   ? Allow that here? (y/N)
 *
 * Before its first iteration:
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
 *
 * followed, when it set stuck tasks aside, by:
 *
 *   Set aside 1 stuck task as blocked
 *     4  stuck: no progress in 2 sessions
 *   Next: taskgraph show 4, then taskgraph set-status --id=4 --status=pending
 *
 * With --dry-run, in place of all of that:
 *
 *   Loop dry run · default preset · up to 3 iterations · Claude CLI
 *     1    sonnet, low effort  Set up the database schema
 *     3.1  default model       Add the session table
 *     4    high effort         Build the login API
 *   Smoke check  npm run smoke
 *   Nothing started; run it without --dry-run
 */

import type {
	LoopIteration,
	LoopPlan,
	LoopPlanTask,
	LoopResult,
	LoopTask
} from '@tm/core';
import chalk from 'chalk';
import { wrapLine } from '../layout/helpers.js';
import { theme } from '../theme.js';
import { terminalSafe } from './markdown-formatters.js';
import { fit, formatSetAside, plural } from './parallel-loop-formatters.js';
import { formatLoopSpend, modelSetting } from './usage-formatters.js';

const NBSP = '\u00a0';

/** A line that can carry an error's text, wrapped at spaces with a hanging indent */
const wrap = (line: string, width: number) =>
	wrapLine(line, width, '  ').join('\n').replaceAll(NBSP, ' ');

/** The spend facts, each kept whole with its ` · ` so a wrap never splits `1m 44s` */
const spendFacts = (spend: Parameters<typeof formatLoopSpend>[0]) =>
	formatLoopSpend(spend).replace(
		/ · ([^·\x1b]+)/g,
		(_, fact: string) => ` ·${NBSP}${fact.replaceAll(' ', NBSP)}`
	);

/**
 * The words of loop's consent: what it says above the question, what "no"
 * and Ctrl-C print, and the error and hint where there's no terminal to ask
 * on. Every line fits 80 columns.
 * @param parallel - The --parallel count; such a run has no sandbox to suggest
 */
export function formatLoopConsent(parallel?: number) {
	const single = parallel === undefined;
	return {
		statement: [
			single
				? 'loop runs Claude Code with permission prompts off.'
				: `loop runs up to ${parallel} Claude Code processes at once, with permission prompts off.`,
			`${single ? 'It' : 'Each'} can read, edit and run anything in this project without asking.`
		].join('\n'),
		question: 'Allow that here?',
		cancelled: single
			? 'Cancelled; nothing ran. To run in Docker instead, pass --sandbox'
			: 'Cancelled; no tasks were claimed',
		error:
			"loop needs your approval to turn Claude Code's permission prompts off",
		hint: single
			? 'Pass `--trust` to allow that here, or `--sandbox` to run in Docker'
			: 'Pass `--trust` to allow that here'
	};
}

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

/** `Loop · default preset · up to 5 iterations · Claude CLI`, fitted to `width` */
function introLine(
	label: string,
	intro: Pick<LoopIntro, 'prompt' | 'isPreset' | 'iterations' | 'sandbox'>,
	width: number
): string {
	const prompt = intro.isPreset
		? `${intro.prompt} preset`
		: `prompt ${intro.prompt}`;
	const iterations =
		intro.iterations === 1
			? '1 iteration'
			: `up to ${intro.iterations} iterations`;
	const mode = intro.sandbox ? 'Docker sandbox' : 'Claude CLI';
	const facts = fit(
		[prompt, iterations, mode].join(' · '),
		width - label.length - 3
	);
	return theme.text(label) + theme.muted(` · ${facts}`);
}

/** The lines `loop` prints before it starts Claude */
export function formatLoopIntro(intro: LoopIntro, width = 80): string[] {
	const lines = [introLine('Loop', intro, width)];

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
			spendFacts({
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
 * The run's summary: why it stopped, the tasks it completed, what it spent,
 * and the stuck tasks it set aside.
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
	// A run that found every task finished started nothing (#1160)
	const counts = theme.muted(
		result.finalStatus === 'all_complete' && result.totalIterations === 0
			? ' · nothing left to work on'
			: ` · ${plural(result.tasksCompleted, 'task')} completed in ${plural(result.totalIterations, 'iteration')}`
	);
	const line = wrap(
		STOP_REASON[result.finalStatus] +
			why +
			counts +
			spendFacts({
				costUsd: result.totalCostUsd,
				costPartial: result.costPartial,
				turns: result.totalTurns,
				durationMs: result.totalDurationMs
			}),
		width
	);
	return [line, ...formatSetAside(result.setAside, width)].join('\n');
}

/** `sonnet, low effort`, or `default model` when the band picks nothing */
const setting = (choice: Pick<LoopPlanTask, 'model' | 'effort'>) =>
	modelSetting(choice) || 'default model';

/** What `loop --dry-run` prints: the tasks a run would work, in order, and at what */
export function formatLoopDryRun(
	plan: LoopPlan,
	options: { isPreset: boolean; sandbox: boolean },
	width = 80
): string[] {
	const lines = [introLine('Loop dry run', { ...plan, ...options }, width)];
	const ids = plan.tasks.map((t) => fit(t.id, 20));
	const settings = plan.tasks.map(setting);
	const idWidth = Math.max(0, ...ids.map((id) => id.length));
	const settingWidth = Math.max(0, ...settings.map((s) => s.length));
	plan.tasks.forEach((task, i) => {
		const head = `  ${ids[i].padEnd(idWidth)}  `;
		const middle = `${settings[i].padEnd(settingWidth)}  `;
		lines.push(
			theme.text(head) +
				theme.muted(middle) +
				theme.text(fit(task.title, width - head.length - middle.length))
		);
	});
	if (!plan.tasks.length) {
		lines.push(
			plan.picksOwnWork
				? theme.muted(
						`  ${fit(`Each iteration picks its own work · ${setting(plan)}`, width - 2)}`
					)
				: chalk.yellow('No task is ready to work on')
		);
	}
	if (plan.smokeCommand) {
		lines.push(
			theme.text('Smoke check  ') +
				theme.muted(fit(plan.smokeCommand, width - 13))
		);
	}
	lines.push(theme.muted('Nothing started; run it without --dry-run'));
	return lines;
}
