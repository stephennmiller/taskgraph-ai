/**
 * @fileoverview What `loop --parallel` prints. While it runs, one line per
 * task (redrawn in place on a terminal):
 *
 *   Running 3 tasks side by side · logs in .taskgraph/worktrees
 *   … 1  running  1m 12s  Set up the database schema
 *   ✓ 2  done     2m 3s   Build the login API
 *   ✗ 3  failed   40s     Write the API docs
 *
 * and a summary at the end:
 *
 *   ✓ 2 of 3 tasks done · 1 branch to review · $1.20
 *     1  taskgraph/task-1 · 2 commits · $0.70 · 31 turns
 *     2  no changes; worktree removed · $0.50 · 18 turns
 *     3  failed: exit 1 · .taskgraph/worktrees/task-3.log
 *   Next: review with git log -p HEAD..taskgraph/task-1
 *
 * The run itself (claims, worktrees, processes) lives in tm-core's
 * ParallelLoopRunner; these functions only turn its data into text.
 */

import path from 'node:path';
import {
	KEPT_OUTCOMES,
	type ParallelLoopResult,
	type ParallelTask,
	type ParallelTaskOutcome,
	stripTerminalControls
} from '@tm/core';
import chalk from 'chalk';
import { formatDuration } from '../components/parse-prd-progress.component.js';
import { theme } from '../theme.js';
import { formatLoopSpend } from './usage-formatters.js';

/** `1 task`, `2 tasks` */
export const plural = (n: number, word: string, many = `${word}s`) =>
	`${n} ${n === 1 ? word : many}`;

/**
 * Task text or a git error as one plain line: escape sequences and control
 * characters out (printed raw, they could move the cursor, rewrite the
 * screen or disguise the text), whitespace collapsed
 */
const plain = (text: string) =>
	stripTerminalControls(text, { singleLine: true });

/** One line of task text, cut with `…` to fit `width` columns */
export const fit = (text: string, width: number) => {
	const clean = plain(text);
	return clean.length > width
		? `${clean.slice(0, Math.max(0, width - 1))}…`
		: clean;
};

/**
 * The stuck tasks a run set to blocked, with how to retry them; none when
 * there are none. `then` when a Next: line comes before it.
 */
export function formatSetAside(
	aside: ParallelLoopResult['setAside'] = [],
	width = 80,
	then = false
): string[] {
	if (!aside.length) return [];
	const id = aside.length === 1 ? fit(aside[0].id, 20) : '<id>';
	return [
		chalk.yellow(`Set aside ${plural(aside.length, 'stuck task')} as blocked`),
		...aside.map((t) => {
			const head = `  ${fit(t.id, 20)}  `;
			return theme.text(head) + theme.muted(fit(t.reason, width - head.length));
		}),
		theme.muted(
			`${then ? 'Then' : 'Next'}: taskgraph show ${id}, then taskgraph set-status --id=${id} --status=pending`
		)
	];
}

/** Paths relative to the project, with forward slashes */
const rel = (projectRoot: string, p: string) =>
	path.relative(projectRoot, p).split(path.sep).join('/') || '.';

const MARK: Record<ParallelTask['state'], string> = {
	running: theme.brand('…'),
	done: chalk.green('✓'),
	failed: chalk.red('✗'),
	stopped: chalk.yellow('■')
};

/**
 * The line above the task lines; without a count while it isn't known.
 * Kept to one line, since the block is redrawn by counting lines.
 */
export function formatParallelHeader(
	count: number | undefined,
	logsDir: string,
	width = 80
): string {
	const what = count === undefined ? 'tasks' : plural(count, 'task');
	const lead = `Running ${what} side by side`;
	const logs = ` · logs in ${logsDir}`;
	if (lead.length + logs.length <= width) {
		return `${lead}${theme.muted(logs)}`;
	}
	return fit(lead, width);
}

/**
 * One status line per task, IDs aligned.
 * @param now - Clock for running tasks' elapsed time
 */
export function formatParallelTaskLines(
	tasks: ParallelTask[],
	options: { now?: number; width?: number } = {}
): string[] {
	const now = options.now ?? Date.now();
	const width = options.width ?? 80;
	const idWidth = Math.max(...tasks.map((t) => t.id.length), 1);
	const times = tasks.map((t) =>
		formatDuration(t.durationMs ?? now - t.startedAt)
	);
	const timeWidth = Math.max(...times.map((t) => t.length), 1);
	return tasks.map((task, i) => {
		const lead = `${task.id.padEnd(idWidth)}  ${task.state.padEnd(7)}  ${times[i].padEnd(timeWidth)}  `;
		const title = fit(task.title, width - 2 - lead.length);
		return `${MARK[task.state]} ${theme.brand(task.id.padEnd(idWidth))}  ${task.state.padEnd(7)}  ${theme.muted(times[i].padEnd(timeWidth))}  ${title}`;
	});
}

/** A kept branch and its work; `failed` adds why it failed, `released` that its claim was freed */
function branchRow(task: ParallelTask, failed = false, released = false) {
	const work = [
		task.commits ? plural(task.commits, 'commit') : null,
		task.uncommitted ? 'uncommitted changes' : null
	].filter(Boolean);
	const why = failed
		? ` ${chalk.red(`(failed: ${plain(task.error ?? 'failed')}${released ? '; worktree kept, claim released' : ''})`)}`
		: '';
	return `${theme.brand(task.branch)}${work.length ? ` ${theme.muted(`· ${work.join(', ')}`)}` : ''}${why}`;
}

/** What became of one task's worktree, for the summary row */
const OUTCOME_TEXT: Record<
	ParallelTaskOutcome,
	(task: ParallelTask, projectRoot: string) => string
> = {
	failed: (task, projectRoot) =>
		`failed: ${plain(task.error ?? 'failed')} ${theme.muted(`· ${rel(projectRoot, task.logFile)}`)}`,
	'set-aside': (task) =>
		`conflicted; work kept on ${theme.brand(task.setAsideAs ?? task.branch)}, task back to pending`,
	merged: (task) =>
		`merged ${theme.brand(task.branch)}${task.commits ? ` ${theme.muted(`· ${plural(task.commits, 'commit')}`)}` : ''}`,
	'no-changes': () => theme.muted('no changes; worktree removed'),
	kept: (task) => branchRow(task),
	stopped: (task) => branchRow(task),
	conflict: (task) => branchRow(task),
	unmerged: (task) => branchRow(task),
	// Released by the runner: a later run retries it in this worktree
	released: (task) => branchRow(task, true, true),
	'failed-kept': (task) => branchRow(task, true),
	'container-running': (task) => branchRow(task, true)
};

/** The flags a rerun needs to stay in containers and reuse the clones */
const rerunFlags = (container?: { image?: string }) =>
	container
		? ` --container${container.image ? ` --container-image ${container.image}` : ''}`
		: '';

/**
 * The end-of-run summary. Never suggests merging: the branches are left
 * for review, unless --merge merged them.
 */
export function formatParallelSummary(
	result: ParallelLoopResult,
	options: {
		projectRoot: string;
		parallel: number;
		/** The run used --container (and maybe --container-image) */
		container?: { image?: string };
	}
): string {
	const { tasks } = result;
	const { projectRoot } = options;
	// --merge found them in review with no branch a run left: not its to merge
	const left = result.leftInReviewIds ?? [];
	const leftInReview = left.length
		? theme.muted(
				`Left in review, with no branch from a run to merge: ${left.map(plain).join(', ')}. Merge the work yourself, then ${theme.brand(`taskgraph set-status --id=${plain(left[0])} --status=done`)}`
			)
		: null;

	if (tasks.length === 0) {
		if (result.aborted) return theme.muted('Cancelled before any task started');
		const skipped = result.skippedIds.length
			? `${plural(result.skippedIds.length, 'ready task')} can't run in a worktree (ID not usable as a branch name: ${result.skippedIds.join(', ')})`
			: 'No tasks are ready to run';
		return [
			skipped,
			...(leftInReview ? [leftInReview] : []),
			theme.muted(
				`Run ${theme.brand('taskgraph graph')} to see what the rest wait on`
			)
		].join('\n');
	}

	const idWidth = Math.max(...tasks.map((t) => t.id.length));
	const rows = tasks.map(
		(t) =>
			`  ${theme.brand(t.id.padEnd(idWidth))}  ${OUTCOME_TEXT[t.outcome ?? 'no-changes'](t, projectRoot)}${formatLoopSpend({ model: t.model, effort: t.effort, costUsd: t.costUsd, costUnknown: t.costUnknown, turns: t.turns })}`
	);
	const spent = formatLoopSpend({
		costUsd: result.totalCostUsd,
		costPartial: result.costPartial
	});
	const kept = tasks.filter((t) => t.outcome && KEPT_OUTCOMES.has(t.outcome));
	const merged = tasks.filter((t) => t.outcome === 'merged').length;
	// Exiting 0 isn't enough: Claude must have marked the task review or done
	const done = tasks.filter((t) => t.finished).length;
	const failed = tasks.filter((t) => t.state === 'failed').length;
	const review = kept.length
		? ` · ${plural(kept.length, 'branch', 'branches')} to review`
		: '';
	const waves =
		result.waves === undefined
			? ''
			: ` · ${merged} merged in ${plural(result.waves, 'wave')}`;

	let lead: string;
	let next: string | null;
	if (result.aborted) {
		lead = theme.muted(
			`Stopped ${plural(tasks.length, 'task')}; claims released${kept.length ? `, ${plural(kept.length, 'worktree')} with work kept` : ''}`
		);
		next = kept.length
			? `Next: ${theme.brand(`taskgraph loop --parallel ${options.parallel}${rerunFlags(options.container)}`)} picks up where they left off`
			: null;
	} else if (failed === tasks.length) {
		lead = `${chalk.red('✗')} ${plural(tasks.length, 'task')} failed${review}${spent}`;
		next = `Next: read the log beside each worktree, e.g. ${theme.brand(rel(projectRoot, tasks[0].logFile))}`;
	} else {
		lead = `${done ? chalk.green('✓') : chalk.red('✗')} ${done} of ${plural(tasks.length, 'task')} done${failed ? ` · ${failed} failed` : ''}${waves}${review}${spent}`;
		next = result.conflictBranch
			? `Next: ${theme.brand(`git merge ${result.conflictBranch}`)} conflicts; resolve it, then run ${theme.brand(`taskgraph loop --parallel ${options.parallel} --merge${rerunFlags(options.container)}`)} again`
			: kept.length
				? `Next: review with ${theme.brand(`git log -p HEAD..${kept[0].branch}`)}`
				: null;
	}

	const held = result.heldBackIds.length
		? theme.muted(
				`Held back ${result.heldBackIds.join(', ')}: ${result.heldBackIds.length === 1 ? 'it edits' : 'they edit'} files a task above edits; the next run takes ${result.heldBackIds.length === 1 ? 'it' : 'them'}`
			)
		: null;

	const notDone = result.notDoneIds?.length
		? `Merged but not done (unchecked criteria): ${result.notDoneIds.join(', ')}. See ${theme.brand(`taskgraph show ${result.notDoneIds[0]}`)}`
		: null;

	const unmergedIds = result.unmergedIds ?? [];
	const why = (id: string) => {
		const t = tasks.find((t) => t.id === id);
		if (t?.uncommitted) {
			return `uncommitted changes in ${rel(projectRoot, t.worktree)}`;
		}
		// A second branch in the wave that still conflicted after a redo (#1025)
		return t?.state === 'failed'
			? `Claude Code failed after setting it to ${t.status}`
			: `${plain(t?.branch ?? id)} conflicts`;
	};
	const unmerged = unmergedIds.length
		? `Not merged, so tasks that depend on them wait: ${unmergedIds.map((id) => `${plain(id)} (${why(id)})`).join(', ')}. Commit or check the work, merge the branch, then ${theme.brand(`taskgraph set-status --id=${plain(unmergedIds[0])} --status=done`)}`
		: null;

	return [
		lead,
		...rows,
		...(result.errorMessage ? [chalk.red(result.errorMessage)] : []),
		...(held ? [held] : []),
		...(notDone ? [notDone] : []),
		...(unmerged ? [unmerged] : []),
		...(leftInReview ? [leftInReview] : []),
		...(next ? [next] : []),
		...formatSetAside(result.setAside, 80, !!next)
	].join('\n');
}
