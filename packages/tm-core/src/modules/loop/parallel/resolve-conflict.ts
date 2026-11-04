/**
 * @fileoverview `--merge` (#973): when a finished task's branch conflicts
 * with what merged before it, Claude Code merges the current commit into the
 * task's worktree and resolves the conflict there, as a person would.
 */

import { execFile } from 'node:child_process';
import path from 'node:path';
import { PROJECT_ROOT_ENV } from '../../../common/utils/project-root-finder.js';
import { childAutoUpdateEnv } from '../child-env.js';
import {
	capArgs,
	loopIterationTimeoutMs
} from '../services/iteration-limits.js';

/** The prompt for one conflict; `commit` is the current branch's commit */
export function buildResolvePrompt(branch: string, commit: string): string {
	return [
		`Branch ${branch}, checked out here, conflicts with commit ${commit}, which other finished tasks were merged into.`,
		'',
		`1. Run \`git merge --no-edit ${commit}\` here.`,
		'2. Resolve every conflict, keeping what both sides meant to do. Change nothing else.',
		'3. Run the tests and type checks, and fix what the merge broke.',
		"4. Commit the merge. Don't push, and don't change any task's status."
	].join('\n');
}

/**
 * Run Claude Code once in the task's worktree to resolve the conflict
 * @returns What it spent, and whether it exited cleanly
 */
export function resolveConflict(options: {
	projectRoot: string;
	worktree: string;
	branch: string;
	commit: string;
	command?: string;
	maxBudgetUsd?: number;
	model?: string;
}): Promise<{ ok: boolean; costUsd: number }> {
	const args = [
		'-p',
		buildResolvePrompt(options.branch, options.commit),
		'--dangerously-skip-permissions',
		'--output-format',
		'json',
		...capArgs({ maxBudgetUsd: options.maxBudgetUsd }),
		...(options.model ? ['--model', options.model] : [])
	];
	return new Promise((resolve) => {
		execFile(
			options.command ?? 'claude',
			args,
			{
				cwd: options.worktree,
				env: childAutoUpdateEnv('parallel', {
					...process.env,
					[PROJECT_ROOT_ENV]: path.resolve(options.projectRoot)
				}),
				timeout: loopIterationTimeoutMs(),
				maxBuffer: 64 * 1024 * 1024
			},
			(error, stdout) => {
				// No result (killed, timed out, crashed): count the whole budget it had
				let costUsd = options.maxBudgetUsd ?? 0;
				try {
					const cost = JSON.parse(stdout).total_cost_usd;
					if (typeof cost === 'number') costUsd = cost;
				} catch {
					// Not JSON: it died before its result
				}
				resolve({ ok: !error, costUsd });
			}
		);
	});
}
