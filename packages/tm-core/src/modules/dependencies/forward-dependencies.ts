/**
 * @fileoverview Dependencies that point forward, and putting generated
 * subtasks in an order without them (#515).
 */

import { resolveSubtaskDependency } from './subtask-dependency.js';

/**
 * Whether a dependency names an item that isn't lower than the one listing
 * it: for a task, a task (or its subtask) at or above it; for a subtask, a
 * sibling at or above it, or an item of a task at or above its parent, which
 * would make the parent wait on that task too.
 * @param id - The task (`3`) or subtask (`3.2`) that lists the dependency
 * @param dependency - The full ID it names (`4`, `3.4`, `2.1`)
 */
export function isForwardDependency(id: string, dependency: string): boolean {
	const [task, sub] = id.split('.');
	const [depTask, depSub] = dependency.split('.');
	if (sub !== undefined && depTask === task && depSub !== undefined) {
		return Number(depSub) >= Number(sub);
	}
	return Number(depTask) >= Number(task);
}

interface GeneratedSubtask {
	id: number;
	dependencies?: Array<string | number>;
}

/**
 * Order the subtasks expand generated so none depends on a later one, and
 * drop a dependency that would hold the parent back.
 *
 * - Subtasks that depend on a later sibling are moved after it (stable
 *   topological order) and the subtasks take their IDs in the new order, with
 *   sibling dependencies following them. A loop between siblings is broken
 *   by dropping the edges that still point forward.
 * - A dependency on a task at or above the parent (or its subtask) that the
 *   parent doesn't already depend on is dropped: adding it to the parent
 *   instead could make a loop between tasks.
 *
 * Subtasks with repeated IDs keep their order, since a sibling reference
 * can't say which one it means.
 * @param parent - The task the subtasks belong to
 * @param subtasks - The generated subtasks, dependencies already cleaned
 * @param log - Told about each dependency dropped
 * @returns New subtask objects; the input is not changed
 */
export function orderGeneratedSubtasks<T extends GeneratedSubtask>(
	parent: { id: string | number; dependencies?: Array<string | number> },
	subtasks: T[],
	log: (message: string) => void = () => {}
): T[] {
	const parentId = String(parent.id);
	const parentDeps = new Set((parent.dependencies ?? []).map(String));
	const index = new Map(subtasks.map((s, i) => [String(s.id), i]));
	const reorder = index.size === subtasks.length;
	const siblingIndex = (raw: string | number): number | undefined => {
		const dep = resolveSubtaskDependency(parentId, raw);
		return dep.startsWith(`${parentId}.`)
			? index.get(dep.slice(parentId.length + 1))
			: undefined;
	};

	const kept = subtasks.map((sub) =>
		(sub.dependencies ?? []).filter((raw) => {
			const dep = resolveSubtaskDependency(parentId, raw);
			if (
				dep.startsWith(`${parentId}.`) ||
				!isForwardDependency(`${parentId}.${sub.id}`, dep) ||
				parentDeps.has(dep) ||
				parentDeps.has(dep.split('.')[0])
			)
				return true;
			log(
				`Dropped dependency ${dep} of subtask ${parentId}.${sub.id}: task ${parentId} doesn't depend on it`
			);
			return false;
		})
	);
	if (!reorder) {
		return subtasks.map((sub, i) => ({ ...sub, dependencies: kept[i] }));
	}

	// Stable Kahn: always place the earliest subtask whose siblings are placed
	const placed: number[] = [];
	const done = new Set<number>();
	while (placed.length < subtasks.length) {
		const pending = subtasks.map((_, i) => i).filter((i) => !done.has(i));
		const waitsOn = (i: number) =>
			kept[i].filter((raw) => {
				const j = siblingIndex(raw);
				return j !== undefined && !done.has(j);
			});
		let next = pending.find((i) => waitsOn(i).length === 0);
		if (next === undefined) {
			// A loop: break it at the earliest subtask
			next = pending[0];
			const loop = new Set(waitsOn(next));
			const sub = subtasks[next];
			for (const raw of loop) {
				log(
					`Dropped dependency ${resolveSubtaskDependency(parentId, raw)} of subtask ${parentId}.${sub.id}: it made a loop`
				);
			}
			kept[next] = kept[next].filter((raw) => !loop.has(raw));
		}
		placed.push(next);
		done.add(next);
	}

	const slots = subtasks.map((s) => s.id).sort((a, b) => a - b);
	const newId = new Map(placed.map((i, pos) => [i, slots[pos]]));
	return placed.map((i, pos) => ({
		...subtasks[i],
		id: slots[pos],
		dependencies: kept[i].map((raw) => {
			const j = siblingIndex(raw);
			if (j === undefined) return raw;
			const id = newId.get(j) as number;
			return typeof raw === 'number' ? id : `${parentId}.${id}`;
		})
	}));
}
