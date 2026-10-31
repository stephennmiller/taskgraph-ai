/**
 * @fileoverview The dependency edges loop checks walk, as full IDs ("3",
 * "3.2"), and whether a new dependency would close a loop. A subtask also
 * waits on its parent's dependencies, and a parent can't finish before its
 * subtasks, so both edges count. A parent's dependency on one of its own
 * subtasks is not passed down.
 */

import type { Task } from '../../common/types/index.js';
import { resolveSubtaskDependency } from './subtask-dependency.js';

/**
 * Every task and subtask's dependencies as full IDs ("3", "3.2"), without
 * self-dependencies, which are reported on their own. A task also gets an
 * edge to each of its subtasks that doesn't list it (#803), and a subtask one
 * to each of its parent's dependencies, except the parent's own subtasks and
 * dependencies the subtask already lists. `subtasksOnly` leaves those implied edges out:
 * they aren't stored on the subtask, so fixDependencies can't break them.
 * @param subtasksOnly - Keep only edges between subtasks, the ones
 *   fixDependencies can break
 */
export function dependencyEdges(
	tasks: Task[],
	{ subtasksOnly = false } = {}
): Map<string, string[]> {
	const graph = new Map<string, string[]>();
	const add = (id: string, deps: string[]) => {
		graph.set(
			id,
			deps.filter((dep) => dep !== id && (!subtasksOnly || dep.includes('.')))
		);
	};
	for (const task of tasks) {
		const taskId = String(task.id);
		const parentDeps = (task.dependencies || []).map(String);
		const subtasks = (task.subtasks || []).map((subtask) => ({
			id: `${taskId}.${subtask.id}`,
			own: (subtask.dependencies || []).map((dep) =>
				resolveSubtaskDependency(taskId, dep)
			)
		}));
		const ownSubtasks = new Set(subtasks.map((subtask) => subtask.id));
		if (!subtasksOnly) {
			// It can't finish before a subtask, unless that subtask lists it (as
			// criticalPath orders them)
			const waitsOn = subtasks.filter(
				(subtask) => !subtask.own.includes(taskId)
			);
			add(taskId, [...parentDeps, ...waitsOn.map((subtask) => subtask.id)]);
		}
		for (const { id, own } of subtasks) {
			const inherited = subtasksOnly
				? []
				: parentDeps.filter(
						(dep) =>
							dep !== taskId && !ownSubtasks.has(dep) && !own.includes(dep)
					);
			add(id, [...own, ...inherited]);
		}
	}
	return graph;
}

/** Subtask IDs stored directly under `taskId` ("1" → "1.1", not "10.1") */
function directSubtaskIds(
	graph: Map<string, string[]>,
	taskId: string
): string[] {
	const prefix = `${taskId}.`;
	const ids: string[] = [];
	for (const id of graph.keys()) {
		if (!id.startsWith(prefix)) continue;
		const rest = id.slice(prefix.length);
		if (rest.length > 0 && !rest.includes('.')) ids.push(id);
	}
	return ids;
}

/**
 * The first id in `targets` that any of `from` reaches along dependency
 * edges. Iterative, so a long chain can't overflow the stack. `from` counts.
 */
function reachesAny(
	graph: Map<string, string[]>,
	from: string[],
	targets: ReadonlySet<string>
): string | undefined {
	const seen = new Set<string>(from);
	const queue = [...from];
	while (queue.length > 0) {
		const id = queue.pop() as string;
		if (targets.has(id)) return id;
		for (const next of graph.get(id) ?? []) {
			if (!seen.has(next)) {
				seen.add(next);
				queue.push(next);
			}
		}
	}
	return undefined;
}

/**
 * Whether making `taskId` depend on `dependencyId` would close a loop.
 * A new dependency of a parent is also a new edge on each of its subtasks
 * (the same edges `dependencyEdges` inherits), unless it names one of the
 * parent's own subtasks, which are not passed down.
 * @returns The id `dependencyId` already depends on that closes the loop
 *   (`taskId` or one of its subtasks), or undefined when there is none
 */
export function wouldCloseDependencyLoop(
	tasks: Task[],
	taskId: string,
	dependencyId: string
): string | undefined {
	const graph = dependencyEdges(tasks);
	const closes = new Set<string>([taskId]);
	if (!taskId.includes('.')) {
		const ownSubtasks = directSubtaskIds(graph, taskId);
		if (!ownSubtasks.includes(dependencyId)) {
			for (const subId of ownSubtasks) {
				if (!(graph.get(subId) ?? []).includes(dependencyId)) {
					closes.add(subId);
				}
			}
		}
	}
	return reachesAny(graph, [dependencyId], closes);
}

/**
 * Whether a new subtask of `parentId` would close a loop. The parent can't
 * finish before it unless it lists the parent, so it loops when what it
 * depends on reaches the parent: `dependencies` (full IDs) for a new subtask,
 * or those of the task `fromTaskId` being moved under the parent. The moved
 * task also starts waiting on the parent's dependencies (not on itself or the
 * parent's subtasks), which loops when one of them reaches it.
 */
export function wouldSubtaskCloseLoop(
	tasks: Task[],
	parentId: string,
	source: { fromTaskId: string } | { dependencies: string[] }
): boolean {
	const graph = dependencyEdges(tasks);
	const reaches = (from: string[], to: string) =>
		reachesAny(graph, from, new Set([to])) !== undefined;
	const waitsOnParent = (deps: string[]) =>
		!deps.includes(parentId) && reaches(deps, parentId);
	if (!('fromTaskId' in source)) return waitsOnParent(source.dependencies);
	const taskId = source.fromTaskId;
	const inherited = (graph.get(parentId) ?? []).filter(
		(dep) => dep !== taskId && !dep.startsWith(`${parentId}.`)
	);
	return waitsOnParent(graph.get(taskId) ?? []) || reaches(inherited, taskId);
}
