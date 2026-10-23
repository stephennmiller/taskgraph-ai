/**
 * @fileoverview Claims: pick the next task and start it in one write, so two
 * sessions working the same tasks never get the same one.
 *
 * A claim sets the task (or subtask) `in-progress` and records who took it
 * and when in its metadata, under `claimedBy` and `claimedAt`. Setting the
 * task back to `pending` clears both.
 */

import os from 'node:os';
import type {
	Subtask,
	Task,
	TaskStatus
} from '../../../common/types/index.js';
import { satisfyArchivedDependencies } from './archive.js';
import { rankNextTasks } from './next-task.js';

/** Who claimed a task and when */
export interface TaskClaim {
	/** The claimed task, or the subtask with a dotted ID such as `5.2` */
	task: Task;
	claimedBy: string;
	claimedAt: string;
}

const CLAIM_KEYS = ['claimedBy', 'claimedAt'] as const;

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
	metadata: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
	if (!metadata || !CLAIM_KEYS.some((key) => key in metadata)) {
		return metadata;
	}
	const rest = { ...metadata };
	for (const key of CLAIM_KEYS) delete rest[key];
	return Object.keys(rest).length > 0 ? rest : undefined;
}

/** Copy of `item` with its metadata replaced; no `metadata` key when empty */
export function withMetadata<T extends { metadata?: Record<string, unknown> }>(
	item: T,
	metadata: Record<string, unknown> | undefined
): T {
	const { metadata: _old, ...rest } = item;
	return (metadata ? { ...rest, metadata } : rest) as T;
}

/** Back to pending means nobody is working on it: drop the claim */
export function releaseClaimIfPending<
	T extends { metadata?: Record<string, unknown> }
>(item: T, status: TaskStatus): T {
	if (status !== 'pending') return item;
	const metadata = withoutClaim(item.metadata);
	return metadata === item.metadata ? item : withMetadata(item, metadata);
}

/** The claimed task with IDs as loadTasks returns them, whatever the file holds */
const asLoaded = (task: Task): Task => ({
	...task,
	id: String(task.id),
	dependencies: (task.dependencies ?? []).map(String)
});

/**
 * Claim the next task nobody has started, by the same order as `next`.
 *
 * @param archivedIds - Tasks in the archive; dependencies on them count as done
 * @returns The changed tasks and the claim, or null when nothing is ready
 */
export function claimNextInTasks(
	tasks: Task[],
	claimedBy: string,
	claimedAt: string = new Date().toISOString(),
	archivedIds: ReadonlySet<string> = new Set()
): { tasks: Task[]; claim: TaskClaim } | null {
	// A task someone else claimed is theirs, subtasks included
	const claimedByOther = new Set(
		tasks
			.filter((task) => {
				const owner = task.metadata?.claimedBy;
				return typeof owner === 'string' && owner !== claimedBy;
			})
			.map((task) => String(task.id))
	);
	const next = rankNextTasks(
		satisfyArchivedDependencies(tasks, archivedIds),
		{ unstartedOnly: true }
	).find(
		(item) => {
			const parentId = (item as Task & { parentId?: string }).parentId;
			return parentId === undefined || !claimedByOther.has(parentId);
		}
	);
	if (!next) return null;

	const claim = { claimedBy, claimedAt };
	const start = <T extends Task | Subtask>(item: T): T => ({
		...item,
		status: 'in-progress',
		updatedAt: claimedAt,
		metadata: { ...(item.metadata ?? {}), ...claim }
	});

	const id = String(next.id);
	if (!id.includes('.')) {
		const updated = tasks.map((task) =>
			String(task.id) === id ? start(task) : task
		);
		const task = updated.find((t) => String(t.id) === id) as Task;
		return { tasks: updated, claim: { task: asLoaded(task), ...claim } };
	}

	const [parentId, subId] = id.split('.');
	const updated = tasks.map((task) => {
		if (String(task.id) !== parentId) return task;
		return {
			...task,
			updatedAt: claimedAt,
			subtasks: task.subtasks.map((sub) =>
				String(sub.id) === subId ? start(sub) : sub
			)
		};
	});
	return {
		tasks: updated,
		claim: { task: asLoaded(start(next)), ...claim }
	};
}
