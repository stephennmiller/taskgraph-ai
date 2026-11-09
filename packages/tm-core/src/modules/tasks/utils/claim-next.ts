/**
 * @fileoverview Claim the next task in one write (see claim.ts for what a
 * claim records). Apart from claim.ts because it picks by `next` order,
 * and next-task.ts depends on claim.ts through parent-status.ts.
 */

import os from 'node:os';
import type { Subtask, Task } from '../../../common/types/index.js';
import { satisfyArchivedDependencies } from './archive.js';
import {
	type ClaimNextOptions,
	type TaskClaim,
	withoutClaim
} from './claim.js';
import { isStaleClaim, rankNextTasks } from './next-task.js';

/** The claimed task with IDs as loadTasks returns them, whatever the file holds */
const asLoaded = (task: Task): Task => ({
	...task,
	id: String(task.id),
	dependencies: (task.dependencies ?? []).map(String)
});

/**
 * Claim the next task nobody has started, by the same order as `next`. A
 * task whose claim is stale (its process died) comes first: it is resumed.
 *
 * @param archivedIds - Tasks in the archive; dependencies on them count as done
 * @returns The changed tasks and the claim, or null when nothing is ready
 */
export function claimNextInTasks(
	tasks: Task[],
	claimedBy: string,
	claimedAt: string = new Date().toISOString(),
	archivedIds: ReadonlySet<string> = new Set(),
	options: ClaimNextOptions = {}
): { tasks: Task[]; claim: TaskClaim } | null {
	// Skips what someone else's live claim holds, subtasks included
	const ranked = rankNextTasks(
		satisfyArchivedDependencies(tasks, archivedIds),
		{
			claimant: claimedBy
		}
	).filter((item) => {
		const parentId = (item as Task & { parentId?: string }).parentId;
		return (
			!options.among ||
			(parentId === undefined && options.among.has(String(item.id)))
		);
	});
	const started = (item: Task) =>
		(item.status || '').toLowerCase() === 'in-progress';
	const next =
		ranked.find((item) => started(item) && isStaleClaim(item.metadata)) ??
		ranked.find((item) => !started(item));
	if (!next) return null;

	const claim = { claimedBy, claimedAt };
	const previous = started(next) ? next.metadata?.claimedBy : undefined;
	const resumed = typeof previous === 'string' ? { resumedFrom: previous } : {};
	const holder =
		options.pid === undefined
			? {}
			: { claimPid: options.pid, claimHost: os.hostname() };
	// A stale claim's pid goes too, so a claim without one never inherits it
	const start = <T extends Task | Subtask>(item: T): T => ({
		...item,
		status: 'in-progress',
		updatedAt: claimedAt,
		metadata: { ...(withoutClaim(item.metadata) ?? {}), ...claim, ...holder }
	});

	const id = String(next.id);
	if (!id.includes('.')) {
		const updated = tasks.map((task) =>
			String(task.id) === id ? start(task) : task
		);
		const task = updated.find((t) => String(t.id) === id) as Task;
		return {
			tasks: updated,
			claim: { task: asLoaded(task), ...claim, ...resumed }
		};
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
		claim: { task: asLoaded(start(next)), ...claim, ...resumed }
	};
}
