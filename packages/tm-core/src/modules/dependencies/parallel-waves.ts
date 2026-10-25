/**
 * @fileoverview Parallel waves: which unfinished tasks can run at the same
 * time. Pure function over a task list.
 *
 * Wave 1 is every ready task: pending or in-progress, with every blocker
 * finished. Wave N holds the tasks whose blockers are all finished or in
 * earlier waves, so a task's wave is one more than its latest blocker's.
 * Everything in one wave can run side by side.
 *
 * Rules (they follow `next`, so wave 1 is the top-level work `next`
 * would consider ready):
 *
 * - Waves hold top-level tasks only. A task is the unit of parallel work;
 *   its subtasks run inside it. That matches the tree `graph` draws.
 * - Finished (`isTaskComplete`: done, completed, cancelled) tasks take no
 *   part and satisfy whatever waits on them.
 * - Whether a dependency is satisfied follows `createDependencyState`. An
 *   open subtask ("2.1") orders the task after its parent (task 2).
 * - Tasks that can't be scheduled get no wave and are listed in
 *   `unscheduled` with the reason: `cycle` (in a dependency loop, including
 *   a task that lists itself), `missing` (names a dependency ID that matches
 *   nothing; `next` never picks such a task either), `held` (open but not
 *   pending or in-progress: review, blocked, deferred), or `waiting` (depends
 *   on a task that has no wave).
 *
 * What counts as a blocker lives in `blockingDependencies` alone, so a
 * narrower notion (only some link types) can be swapped in at one place.
 *
 * Iterative throughout; long chains don't overflow the stack.
 */

import { isTaskComplete } from '../../common/constants/index.js';
import type { Task } from '../../common/types/index.js';
import { createDependencyState } from './dependency-check.js';
import { compareIds, stronglyConnectedComponents } from './dependency-graph.js';

export type UnscheduledReason = 'cycle' | 'missing' | 'held' | 'waiting';

export interface UnscheduledTask {
	id: string;
	reason: UnscheduledReason;
	/**
	 * What holds it: the loop members it depends on (`cycle`), the IDs that
	 * match nothing (`missing`), the unscheduled tasks it waits on
	 * (`waiting`); empty for `held`
	 */
	blockers: string[];
}

export interface ParallelWaves {
	/** Task IDs per wave, in ID order; `waves[0]` is wave 1 (ready now) */
	waves: string[][];
	/** Wave number (from 1) of every scheduled task; plain object, JSON-safe */
	waveOf: Record<string, number>;
	/** Open tasks with no wave, in ID order */
	unscheduled: UnscheduledTask[];
}

/** Statuses a wave can hold; a task with no status counts as pending */
const isSchedulable = (task: Task) =>
	(task.status ?? 'pending') === 'pending' || task.status === 'in-progress';

/**
 * The dependency IDs that block a task, as written. The single place that
 * decides which dependencies count as blockers.
 */
export function blockingDependencies(task: Task): string[] {
	return (task.dependencies ?? []).map(String);
}

export function parallelWaves(tasks: Task[]): ParallelWaves {
	const byId = new Map(tasks.map((t) => [String(t.id), t]));
	const dependencyState = createDependencyState(tasks);
	const finished = (t: Task) => isTaskComplete(t.status);
	const open = tasks.filter((t) => !finished(t)).map((t) => String(t.id));

	// Resolve each open task's blockers to open top-level task IDs
	const blockers = new Map<string, string[]>();
	const missing = new Map<string, string[]>();
	const selfLoop = new Set<string>();
	for (const id of open) {
		const deps = new Set<string>();
		const gone: string[] = [];
		for (const dep of new Set(blockingDependencies(byId.get(id) as Task))) {
			if (dep === id) {
				selfLoop.add(id);
				continue;
			}
			const state = dependencyState(id, dep);
			if (state === 'missing') gone.push(dep);
			// A subtask orders the task after its parent
			else if (state === 'open')
				deps.add(byId.has(dep) ? dep : dep.split('.')[0]);
		}
		blockers.set(id, [...deps]);
		missing.set(id, gone);
	}

	const dependents = new Map<string, string[]>(open.map((id) => [id, []]));
	for (const [id, deps] of blockers) {
		for (const dep of deps) (dependents.get(dep) as string[]).push(id);
	}

	const unscheduled = new Map<string, UnscheduledTask>();
	const cycleOf = new Map<string, Set<string>>();
	for (const group of stronglyConnectedComponents(
		open,
		(id) => blockers.get(id) as string[]
	)) {
		if (group.length === 1 && !selfLoop.has(group[0])) continue;
		const members = new Set(group);
		for (const id of group) cycleOf.set(id, members);
	}
	for (const [id, members] of cycleOf) {
		const inLoop = (blockers.get(id) as string[]).filter((d) => members.has(d));
		unscheduled.set(id, {
			id,
			reason: 'cycle',
			blockers: (selfLoop.has(id) ? [id, ...inLoop] : inLoop).sort(compareIds)
		});
	}

	// Kahn's order, dependencies first; loop members are never released
	// No prototype: IDs like "constructor" or "__proto__" are plain keys
	const waveOf: Record<string, number> = Object.create(null);
	const left = new Map(
		open.map((id) => [id, (blockers.get(id) as string[]).length])
	);
	const queue = open.filter((id) => left.get(id) === 0 && !cycleOf.has(id));
	const place = (id: string, stuck: string[]) => {
		const gone = missing.get(id) as string[];
		if (!isSchedulable(byId.get(id) as Task)) {
			unscheduled.set(id, { id, reason: 'held', blockers: [] });
		} else if (gone.length) {
			unscheduled.set(id, { id, reason: 'missing', blockers: gone });
		} else if (stuck.length) {
			unscheduled.set(id, {
				id,
				reason: 'waiting',
				blockers: stuck.sort(compareIds)
			});
		} else {
			const deps = blockers.get(id) as string[];
			waveOf[id] = 1 + Math.max(0, ...deps.map((d) => waveOf[d]));
		}
	};
	for (let i = 0; i < queue.length; i++) {
		const id = queue[i];
		place(
			id,
			(blockers.get(id) as string[]).filter((d) => unscheduled.has(d))
		);
		for (const next of dependents.get(id) as string[]) {
			const remaining = (left.get(next) as number) - 1;
			left.set(next, remaining);
			if (remaining === 0 && !cycleOf.has(next)) queue.push(next);
		}
	}

	// Never released: downstream of a loop
	for (const id of open) {
		if (unscheduled.has(id) || waveOf[id] !== undefined) continue;
		place(
			id,
			(blockers.get(id) as string[]).filter((d) => waveOf[d] === undefined)
		);
	}

	const waves: string[][] = [];
	for (const [id, wave] of Object.entries(waveOf)) {
		(waves[wave - 1] ??= []).push(id);
	}
	for (const wave of waves) wave.sort(compareIds);

	return {
		waves,
		waveOf,
		unscheduled: [...unscheduled.values()].sort((a, b) =>
			compareIds(a.id, b.id)
		)
	};
}
