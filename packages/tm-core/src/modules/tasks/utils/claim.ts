/**
 * @fileoverview Claims: pick the next task and start it in one write, so two
 * sessions working the same tasks never get the same one.
 *
 * A claim sets the task (or subtask) `in-progress` and records who took it
 * and when in its metadata, under `claimedBy` and `claimedAt`, plus the
 * holding process as `claimPid` and `claimHost` when a long-lived process
 * (`loop --parallel`) holds it, and that run's worker as `claimWorkerPid`.
 * A move that gives the work up (pending, blocked, deferred) clears them;
 * done, review and cancelled keep who and when as a record of who did it.
 */

import os from 'node:os';
import type { Task, TaskStatus } from '../../../common/types/index.js';

/** Who claimed a task and when */
export interface TaskClaim {
	/** The claimed task, or the subtask with a dotted ID such as `5.2` */
	task: Task;
	claimedBy: string;
	claimedAt: string;
}

const HOLDER_KEYS = ['claimPid', 'claimHost', 'claimWorkerPid'] as const;
const CLAIM_KEYS = ['claimedBy', 'claimedAt', ...HOLDER_KEYS] as const;

/**
 * The name a claim is recorded under: the session ID when one is set
 * (TASKGRAPH_SESSION_ID, or Claude Code's CLAUDE_CODE_SESSION_ID), otherwise
 * the user name.
 */
export function resolveClaimant(env: NodeJS.ProcessEnv = process.env): string {
	const fromEnv = [
		env.TASKGRAPH_SESSION_ID,
		env.CLAUDE_CODE_SESSION_ID,
		env.USER,
		env.USERNAME
	].find((value) => value?.trim());
	if (fromEnv) return fromEnv.trim();
	try {
		return os.userInfo().username || 'unknown';
	} catch {
		return 'unknown';
	}
}

/**
 * Metadata without a claim. Returns the same object when there is no claim,
 * and undefined when the claim was all it held.
 */
export function withoutClaim(
	metadata: Record<string, unknown> | undefined,
	keys: readonly string[] = CLAIM_KEYS
): Record<string, unknown> | undefined {
	if (!metadata || !keys.some((key) => key in metadata)) {
		return metadata;
	}
	const rest = { ...metadata };
	for (const key of keys) delete rest[key];
	return Object.keys(rest).length > 0 ? rest : undefined;
}

/** Copy of `item` with its metadata replaced; no `metadata` key when empty */
function withMetadata<T extends { metadata?: Record<string, unknown> }>(
	item: T,
	metadata: Record<string, unknown> | undefined
): T {
	const { metadata: _old, ...rest } = item;
	return (metadata ? { ...rest, metadata } : rest) as T;
}

const GIVEN_UP: ReadonlySet<TaskStatus> = new Set([
	'pending',
	'blocked',
	'deferred'
]);

/**
 * Pending, blocked or deferred means nobody is working on it: drop the
 * claim. Any other change drops the holding process, which held only the
 * claimed in-progress run: else a task reopened from review would look
 * like a dead run's to take over (#1044)
 */
export function releaseClaimIfGivenUp<
	T extends { metadata?: Record<string, unknown> }
>(item: T, status: TaskStatus): T {
	const metadata = withoutClaim(
		item.metadata,
		GIVEN_UP.has(status) ? CLAIM_KEYS : HOLDER_KEYS
	);
	return metadata === item.metadata ? item : withMetadata(item, metadata);
}

/** Which tasks a claim may pick */
export interface ClaimNextOptions {
	/**
	 * Only these top-level task IDs, in `next` order (for example one
	 * parallel wave). Subtasks are never picked when this is set.
	 */
	among?: ReadonlySet<string>;
	/**
	 * The process that holds the claim for as long as the work runs. Once it
	 * is gone, a later claim may take the task over. Leave unset for a
	 * process that exits right after claiming: the claim then never goes stale.
	 */
	pid?: number;
}

/**
 * Record the worker a parallel run spawned for top-level task `id` as
 * `claimWorkerPid`, while the task is still in-progress under the run's claim
 * (`claimedBy` and `claimPid`): the claim then stays live while the worker
 * runs, even if the run itself was killed (#1051)
 * @returns The changed tasks, or null when the claim isn't the run's any more
 */
export function recordClaimWorkerIn(
	tasks: Task[],
	id: string,
	holder: { claimedBy: string; claimPid: number },
	workerPid: number
): Task[] | null {
	const index = tasks.findIndex((task) => String(task.id) === id);
	const task = tasks[index];
	if (
		!task ||
		task.status !== 'in-progress' ||
		task.metadata?.claimedBy !== holder.claimedBy ||
		task.metadata?.claimPid !== holder.claimPid
	) {
		return null;
	}
	const updated = [...tasks];
	updated[index] = withMetadata(task, {
		...task.metadata,
		claimWorkerPid: workerPid
	});
	return updated;
}
