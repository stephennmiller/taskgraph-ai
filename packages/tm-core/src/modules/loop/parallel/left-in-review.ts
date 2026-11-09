/**
 * @fileoverview `loop --parallel --merge` (#1124): the tasks an interrupted
 * run left in `review` with their work on a branch. The next `--merge` run
 * merges them first, without running Claude Code on them again.
 */

import { isSafeTaskId } from '../../../common/utils/safe-task-id.js';
import type { TasksDomain } from '../../tasks/tasks-domain.js';
import {
	taskBranchName,
	taskLogPath,
	taskWorktreePath
} from './parallel-plan.js';
import type { TaskWorktrees } from './task-worktrees.js';
import type { ParallelTask } from './types.js';

/**
 * The tag's `review` tasks, split in two: `tasks` have a branch that is
 * still where a run left it when its Claude Code ended without an error
 * (TaskWorktrees.isWhereRunLeft), so it holds only work that session made,
 * and are ready for the merge step. `leftIds` have no such branch (set to
 * review by hand, branch deleted or moved since, made by a `--container`
 * run, Claude Code failed or was stopped, or another run's is still
 * working) and are left alone.
 */
export async function tasksLeftInReview(
	projectRoot: string,
	tasks: TasksDomain,
	git: TaskWorktrees,
	tag?: string
): Promise<{ tasks: ParallelTask[]; leftIds: string[] }> {
	const found: ParallelTask[] = [];
	const leftIds: string[] = [];
	let base: string | undefined;
	for (const task of (await tasks.list({ tag })).tasks) {
		if (task.status !== 'review') continue;
		const id = String(task.id);
		const branch = isSafeTaskId(id) ? taskBranchName(id) : undefined;
		if (!branch || !(await git.isWhereRunLeft(branch))) {
			leftIds.push(id);
			continue;
		}
		const worktree = taskWorktreePath(projectRoot, id);
		base ??= await git.head();
		found.push({
			id,
			title: task.title,
			branch,
			worktree,
			logFile: taskLogPath(projectRoot, id),
			// As the run that was interrupted settled it
			state: 'done',
			startedAt: Date.now(),
			status: 'review',
			finished: true,
			claimed: false,
			outcome: 'kept',
			...(await git.work(worktree, branch, base))
		});
	}
	return { tasks: found, leftIds };
}
