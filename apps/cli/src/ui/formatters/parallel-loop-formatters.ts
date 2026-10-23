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
 *   ✓ 2 of 3 tasks done · 1 branch to review
 *     1  taskgraph/task-1 · 2 commits
 *     2  no changes; worktree removed
 *     3  failed: exit 1 · .taskgraph/worktrees/task-3.log
 *   Next: review with git log -p HEAD..taskgraph/task-1
 *
 * The run itself (claims, worktrees, processes) lives in tm-core's
 * ParallelLoopRunner; these functions only turn its data into text.
 */

import path from 'node:path';
import type { ParallelLoopResult, ParallelTask } from '@tm/core';
import chalk from 'chalk';
import { formatDuration } from '../components/parse-prd-progress.component.js';
import { theme } from '../theme.js';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

// Escape sequences and other control characters from task text or git
// errors (and bidi overrides): printed raw, they could move the cursor,
// rewrite the screen or disguise the text
const CONTROL =
	/\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)?|[@-Z\\-_])|[\x00-\x08\x0b-\x1f\x7f-\x9f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

/** Plain one-line text: control characters out, whitespace collapsed */
const plain = (text: string) =>
	text.replace(/\s+/g, ' ').replace(CONTROL, '').replace(/ +/g, ' ').trim();

const fit = (text: string, width: number) => {
	const clean = plain(text);
	return clean.length > width
		? `${clean.slice(0, Math.max(0, width - 1))}…`
		: clean;
};

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

/** What became of one task's worktree, for the summary row */
function outcome(task: ParallelTask, projectRoot: string): string {
	if (task.state === 'failed' && !task.kept) {
		const why = plain(task.error ?? 'failed');
		return `failed: ${why} ${theme.muted(`· ${rel(projectRoot, task.logFile)}`)}`;
	}
	if (!task.kept) return theme.muted('no changes; worktree removed');
	const work = [
		task.commits ? plural(task.commits, 'commit') : null,
		task.uncommitted ? 'uncommitted changes' : null
	].filter(Boolean);
	const failed =
		task.state === 'failed'
			? ` ${chalk.red(`(failed: ${plain(task.error ?? 'failed')})`)}`
			: '';
	return `${theme.brand(task.branch)}${work.length ? ` ${theme.muted(`· ${work.join(', ')}`)}` : ''}${failed}`;
}

/**
 * The end-of-run summary. Never suggests merging: the branches are left
 * for review.
 */
export function formatParallelSummary(
	result: ParallelLoopResult,
	options: { projectRoot: string; parallel: number }
): string {
	const { tasks } = result;
	const { projectRoot } = options;

	if (tasks.length === 0) {
		if (result.aborted) return theme.muted('Cancelled before any task started');
		const skipped = result.skippedIds.length
			? `${plural(result.skippedIds.length, 'ready task')} can't run in a worktree (ID not usable as a branch name: ${result.skippedIds.join(', ')})`
			: 'No tasks are ready to run';
		return [
			skipped,
			theme.muted(
				`Run ${theme.brand('taskgraph graph')} to see what the rest wait on`
			)
		].join('\n');
	}

	const idWidth = Math.max(...tasks.map((t) => t.id.length));
	const rows = tasks.map(
		(t) => `  ${theme.brand(t.id.padEnd(idWidth))}  ${outcome(t, projectRoot)}`
	);
	const kept = tasks.filter((t) => t.kept);
	const done = tasks.filter((t) => t.state === 'done').length;
	const failed = tasks.filter((t) => t.state === 'failed').length;
	const review = kept.length
		? ` · ${plural(kept.length, 'branch')} to review`
		: '';

	let lead: string;
	let next: string | null;
	if (result.aborted) {
		lead = theme.muted(
			`Stopped ${plural(tasks.length, 'task')}; claims released${kept.length ? `, ${plural(kept.length, 'worktree')} with work kept` : ''}`
		);
		next = kept.length
			? `Next: ${theme.brand(`taskgraph loop --parallel ${options.parallel}`)} picks up where they left off`
			: null;
	} else if (done === 0) {
		lead = `${chalk.red('✗')} ${plural(tasks.length, 'task')} failed${review}`;
		next = `Next: read the log beside each worktree, e.g. ${theme.brand(rel(projectRoot, tasks[0].logFile))}`;
	} else {
		lead = `${chalk.green('✓')} ${done} of ${plural(tasks.length, 'task')} done${failed ? ` · ${failed} failed` : ''}${review}`;
		next = kept.length
			? `Next: review with ${theme.brand(`git log -p HEAD..${kept[0].branch}`)}`
			: null;
	}

	return [lead, ...rows, ...(next ? [next] : [])].join('\n');
}
