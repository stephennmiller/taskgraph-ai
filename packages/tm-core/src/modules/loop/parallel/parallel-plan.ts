/**
 * @fileoverview Pure rules for `loop --parallel`: which flags it takes, which
 * task IDs are safe to put in a branch or path, where each task's worktree
 * and log go, which tasks may run side by side, and the prompt each Claude
 * Code process gets.
 */

import path from 'node:path';
import { TASKGRAPH_WORKTREES_DIR } from '../../../common/constants/paths.js';
import type { RelevantFile } from '../../../common/types/index.js';
import { TASK_DATA_RULE } from '../../../common/utils/prompt-tag.js';
import { taskCommitTag } from '../../tasks/utils/task-commits.js';
import { isSafeTaskId } from '../../../common/utils/safe-task-id.js';
import { LoopError } from '../loop-task.js';

/** Upper bound on `--parallel`: each task is a full Claude Code session */
export const MAX_PARALLEL = 16;

/** Branch prefix for task worktrees: `taskgraph/task-<id>` */
const TASK_BRANCH_PREFIX = 'taskgraph/task-';

/** A `--parallel` error the CLI prints as-is, with the fix underneath */
export class ParallelLoopError extends LoopError {
	constructor(message: string, hint?: string) {
		super(message, hint);
		this.name = 'ParallelLoopError';
	}
}

/**
 * Parse `--parallel <n>`: a whole number from 1 to MAX_PARALLEL.
 * @throws ParallelLoopError naming the value typed
 */
export function parseParallelCount(value: string | number): number {
	const text = String(value).trim();
	const n = /^\d+$/.test(text) ? Number(text) : Number.NaN;
	if (!Number.isInteger(n) || n < 1 || n > MAX_PARALLEL) {
		throw new ParallelLoopError(
			`"${text}" isn't a task count for --parallel`,
			`Pass a whole number from 1 to ${MAX_PARALLEL}, e.g. \`taskgraph loop --parallel 3\``
		);
	}
	return n;
}

/** The `loop` flags that matter to `--parallel` */
export interface ParallelFlags {
	prompt?: string;
	iterations?: number;
	sandbox?: boolean;
	verbose?: boolean;
	/** `--id`: --parallel picks its own tasks from wave 1 */
	taskId?: string;
}

/**
 * `--parallel` runs each ready task once with the default prompt, so it
 * can't combine with flags that change the prompt, the iteration count, or
 * how output streams. Nor with `--sandbox`: see below.
 * @throws ParallelLoopError naming the first flag that doesn't fit
 */
export function assertParallelFlags(flags: ParallelFlags): void {
	if (flags.sandbox) {
		// A task worktree's git data lives in the main repository's .git,
		// outside the folder a Docker sandbox mounts, so Claude couldn't commit
		throw new ParallelLoopError(
			"--parallel can't run in the Docker sandbox: a task worktree's git data is outside the folder the sandbox mounts, so Claude couldn't commit there",
			'Use --container to run each task in its own container instead'
		);
	}
	const conflict =
		flags.prompt && flags.prompt !== 'default'
			? '--prompt'
			: flags.iterations !== undefined
				? '--iterations'
				: flags.verbose
					? '--verbose'
					: flags.taskId !== undefined
						? '--id'
						: null;
	if (conflict) {
		throw new ParallelLoopError(
			`--parallel can't be combined with ${conflict}`,
			'Each task gets one Claude Code run with the default prompt; drop ' +
				`${conflict}, or run \`taskgraph loop\` without --parallel`
		);
	}
}

function assertSafe(id: string): void {
	if (!isSafeTaskId(id)) {
		throw new ParallelLoopError(`"${id}" can't be used in a branch name`);
	}
}

/** `taskgraph/task-<id>` */
export function taskBranchName(id: string): string {
	assertSafe(id);
	return `${TASK_BRANCH_PREFIX}${id}`;
}

/** Where task worktrees and their logs live, under the project */
export function worktreesDir(projectRoot: string): string {
	return path.join(projectRoot, TASKGRAPH_WORKTREES_DIR);
}

/** `.taskgraph/worktrees/task-<id>` */
export function taskWorktreePath(projectRoot: string, id: string): string {
	assertSafe(id);
	return path.join(worktreesDir(projectRoot), `task-${id}`);
}

/** `.taskgraph/worktrees/task-<id>.log`: Claude's output, beside the worktree */
export function taskLogPath(projectRoot: string, id: string): string {
	assertSafe(id);
	return path.join(worktreesDir(projectRoot), `task-${id}.log`);
}

/**
 * The prompt for one task's Claude Code process. Only the ID and the tag go
 * in, both checked; Claude reads the task itself with `taskgraph show`.
 * It reaches Claude as one argv entry, never through a shell.
 *
 * The project path isn't in it: the runner sets TASKGRAPH_PROJECT_ROOT for
 * the process instead, so every `taskgraph` command Claude (or a plugin
 * hook) runs works on the main project's tasks.json without Claude having
 * to remember a flag, and no path is ever pasted into Claude's shell.
 *
 * Claude marks the task `review`, not `done`: its work sits on an unmerged
 * branch, and a `done` task would let the tasks that depend on it start
 * from a commit that doesn't have it.
 */
export function buildParallelPrompt(options: {
	taskId: string;
	tag?: string;
	/** The tag the run works on when `tag` is left out, for the commit marker */
	activeTag?: string;
	/** `--container`: Claude works in its own clone, on a copy of the tasks */
	container?: boolean;
}): string {
	const { taskId, tag, activeTag, container } = options;
	const branch = taskBranchName(taskId);
	if (tag !== undefined && !/^[A-Za-z0-9_-]+$/.test(tag)) {
		throw new ParallelLoopError(`"${tag}" isn't a tag name`);
	}
	if (activeTag !== undefined && !/^[A-Za-z0-9_./-]+$/.test(activeTag)) {
		throw new ParallelLoopError(`"${activeTag}" isn't a tag name`);
	}
	// show finds a task's commits by this marker (#1027)
	const marker = taskCommitTag(taskId, tag ?? activeTag);
	const tagFlag = tag ? ` --tag=${tag}` : '';
	return [
		container
			? `You are working on TaskGraph task ${taskId}, alone, in a container, in your own clone of the repository on branch ${branch}. Other tasks are being worked on in other containers at the same time.`
			: `You are working on TaskGraph task ${taskId}, alone, in its own git worktree on branch ${branch}. Other tasks are being worked on in other worktrees at the same time.`,
		'',
		container
			? "`taskgraph` commands here work on a copy of the project's tasks that TASKGRAPH_PROJECT_ROOT points to; the task's status is read back from it when you're done. Don't change it, don't pass --project, and don't edit or commit anything under .taskgraph/tasks/."
			: "`taskgraph` commands here work on the main project's tasks, not this worktree's copy: TASKGRAPH_PROJECT_ROOT points there. Don't change it, don't pass --project, and don't edit or commit anything under .taskgraph/tasks/.",
		'',
		`1. Read the task: \`taskgraph show ${taskId}${tagFlag}\`.`,
		'2. Implement it here, with the smallest change that does the job, and run the tests and type checks that cover it.',
		`3. Commit your work on ${branch}, ending each commit message with ${marker}. Don't merge, rebase or push; the branch is left for review.`,
		`4. Mark it ready for review, checking off by number the acceptance criteria your work meets (\`show\` lists them), so it can be marked done once merged: \`taskgraph set-status --id=${taskId} --status=review --check=<numbers>${tagFlag}\`. Leave out --check if the task has no criteria.`,
		'',
		`Work only on task ${taskId}. Don't start another task.`,
		'',
		TASK_DATA_RULE
	].join('\n');
}

interface FilesOf {
	relevantFiles?: RelevantFile[];
	subtasks?: { relevantFiles?: RelevantFile[] }[];
}

/**
 * The files a task says it creates or modifies (its own and its subtasks'),
 * normalized so `./src/a.ts` and `src/a.ts` match. A file it only reads
 * doesn't count: two tasks may read the same file at once.
 */
export function plannedFiles(task: FilesOf): string[] {
	return [task, ...(task.subtasks ?? [])].flatMap((t) =>
		(t.relevantFiles ?? [])
			.filter((f) => f.action !== 'reference' && f.path)
			.map((f) => path.posix.normalize(f.path.replaceAll('\\', '/')))
	);
}

/** Each task's planned files, by task ID */
export function plannedFilesById(
	tasks: (FilesOf & { id: string | number })[]
): Map<string, string[]> {
	return new Map(tasks.map((t) => [String(t.id), plannedFiles(t)]));
}

/**
 * The IDs in `ids` whose planned files don't touch `busy`, the files of the
 * tasks already running: `--parallel` never runs two tasks that would edit
 * the same file. A task with no planned files is always free.
 */
export function freeOfOverlap(
	ids: Iterable<string>,
	files: ReadonlyMap<string, string[]>,
	busy: ReadonlySet<string>
): Set<string> {
	return new Set(
		[...ids].filter((id) => !(files.get(id) ?? []).some((f) => busy.has(f)))
	);
}
