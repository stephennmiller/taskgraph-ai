/**
 * @fileoverview `--merge` (#973): when a finished task's branch conflicts
 * with what merged before it, Claude Code merges the current commit into the
 * task's worktree and resolves the conflict there, as a person would.
 */

import path from 'node:path';
import { PROJECT_ROOT_ENV } from '../../../common/utils/project-root-finder.js';
import { childAutoUpdateEnv } from '../child-env.js';
import {
	KILL_GRACE_MS,
	spawnInOwnGroup,
	stopProcessGroup
} from '../process-group.js';
import {
	capArgs,
	loopIterationTimeoutMs
} from '../services/iteration-limits.js';

/** The prompt for one conflict; `commit` is the current branch's commit */
function buildResolvePrompt(branch: string, commit: string): string {
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
	/** Stops Claude Code when the run is aborted */
	signal?: AbortSignal;
	/** How long a stopped Claude Code gets to exit before SIGKILL (default 5000) */
	killGraceMs?: number;
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
	// No result (killed, timed out, crashed): count the whole budget it had
	const failed = { ok: false, costUsd: options.maxBudgetUsd ?? 0 };
	if (options.signal?.aborted) return Promise.resolve(failed);
	return new Promise((resolve) => {
		// Its own process group, so a stop reaches what Claude started too
		const child = spawnInOwnGroup(options.command ?? 'claude', args, {
			cwd: options.worktree,
			env: childAutoUpdateEnv('parallel', {
				...process.env,
				[PROJECT_ROOT_ENV]: path.resolve(options.projectRoot)
			}),
			stdio: ['ignore', 'pipe', 'ignore']
		});
		let stdout = '';
		let stopped = false;
		const stop = () => {
			stopped = true;
			stopProcessGroup(child, options.killGraceMs ?? KILL_GRACE_MS);
			// A subprocess Claude started can hold the pipe open: close it so 'close' fires
			child.stdout?.destroy();
		};
		const timer = setTimeout(stop, loopIterationTimeoutMs());
		options.signal?.addEventListener('abort', stop, { once: true });
		const done = (code: number | null) => {
			clearTimeout(timer);
			options.signal?.removeEventListener('abort', stop);
			let costUsd = failed.costUsd;
			try {
				const cost = JSON.parse(stdout).total_cost_usd;
				if (typeof cost === 'number') costUsd = cost;
			} catch {
				// Not JSON: it died before its result
			}
			resolve({ ok: code === 0 && !stopped, costUsd });
		};
		child.stdout?.setEncoding('utf8').on('data', (chunk: string) => {
			stdout += chunk;
		});
		child.once('error', () => done(null));
		child.once('close', done);
	});
}
