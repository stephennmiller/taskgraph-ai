/**
 * @fileoverview Dependency graph analysis: pure functions over a task list.
 *
 * Tasks and subtasks are flattened into one graph keyed by task ID (subtasks
 * use dotted IDs like "2.1"). A bare number in a subtask's dependencies means
 * a sibling ("1" under task 2 is "2.1"), as it does in `getNextTask`.
 * Dependency IDs that match no task are recorded as `missing` and never become
 * edges; self-dependencies are ignored. Tasks whose status satisfies
 * dependencies (done, cancelled) are finished and take no part in
 * `blockedCount` or `criticalPath`. `findCycles` looks at every task.
 */

import { isTaskComplete } from '../../common/constants/index.js';
import type { Task, TaskStatus } from '../../common/types/index.js';

export interface DependencyGraphNode {
	id: string;
	title: string;
	status: TaskStatus;
	priority?: Task['priority'];
	/** Dependency IDs that match a task (excluding the task itself) */
	dependencies: string[];
	/** Dependency IDs that don't match any task */
	missing: string[];
	/** IDs of tasks that list this one as a dependency */
	dependents: string[];
}

export interface DependencyGraph {
	/** Every task and subtask by ID, parents before their subtasks */
	nodes: Map<string, DependencyGraphNode>;
}

export const compareIds = (a: string, b: string): number =>
	a.localeCompare(b, undefined, { numeric: true });

export function buildDependencyGraph(tasks: Task[]): DependencyGraph {
	const raw: Array<{
		id: string;
		title: string;
		status: TaskStatus;
		priority?: Task['priority'];
		deps: string[];
	}> = [];

	for (const task of tasks) {
		const id = String(task.id);
		raw.push({
			id,
			title: task.title,
			status: task.status,
			priority: task.priority,
			deps: (task.dependencies ?? []).map(String)
		});
		for (const sub of task.subtasks ?? []) {
			raw.push({
				id: `${id}.${sub.id}`,
				title: sub.title,
				status: sub.status ?? 'pending',
				priority: sub.priority ?? task.priority,
				deps: (sub.dependencies ?? []).map((d) => {
					const dep = String(d);
					return dep.includes('.') ? dep : `${id}.${dep}`;
				})
			});
		}
	}

	const nodes = new Map<string, DependencyGraphNode>();
	for (const r of raw) {
		nodes.set(r.id, {
			id: r.id,
			title: r.title,
			status: r.status,
			priority: r.priority,
			dependencies: [],
			missing: [],
			dependents: []
		});
	}
	for (const r of raw) {
		const node = nodes.get(r.id) as DependencyGraphNode;
		for (const dep of new Set(r.deps)) {
			if (dep === r.id) continue;
			const target = nodes.get(dep);
			if (target) {
				node.dependencies.push(dep);
				target.dependents.push(r.id);
			} else {
				node.missing.push(dep);
			}
		}
	}
	return { nodes };
}

const isOpen = (node: DependencyGraphNode): boolean =>
	!isTaskComplete(node.status);

/**
 * For every task, how many unfinished tasks are (transitively) waiting on it.
 * Finished tasks count 0 and are not traversed. Cycle-safe; a task never
 * counts itself.
 */
export function blockedCount(tasks: Task[]): Map<string, number> {
	const { nodes } = buildDependencyGraph(tasks);
	const counts = new Map<string, number>();

	for (const node of nodes.values()) {
		if (!isOpen(node)) {
			counts.set(node.id, 0);
			continue;
		}
		const seen = new Set<string>([node.id]);
		const stack = [...node.dependents];
		while (stack.length) {
			const id = stack.pop() as string;
			if (seen.has(id)) continue;
			const next = nodes.get(id) as DependencyGraphNode;
			if (!isOpen(next)) continue;
			seen.add(id);
			stack.push(...next.dependents);
		}
		counts.set(node.id, seen.size - 1);
	}
	return counts;
}

/**
 * Tasks in dependency cycles, one sorted group per cycle (strongly connected
 * component), groups sorted by their first ID. Considers every task, finished
 * or not.
 */
export function findCycles(tasks: Task[]): string[][] {
	return stronglyConnected(buildDependencyGraph(tasks).nodes, () => true);
}

/**
 * Longest chain of unfinished work, dependencies first. Tasks in a cycle are
 * left out (they can't be ordered), as are missing dependencies. Ties go to
 * the lowest IDs. Empty when nothing is left to do.
 */
export function criticalPath(tasks: Task[]): string[] {
	const { nodes } = buildDependencyGraph(tasks);
	const cyclic = new Set(stronglyConnected(nodes, isOpen).flat());
	const usable = (id: string) => {
		const node = nodes.get(id) as DependencyGraphNode;
		return isOpen(node) && !cyclic.has(id);
	};

	// Longest chain ending at each task, and the dependency it extends
	const best = new Map<string, { length: number; via: string | null }>();
	const measure = (id: string): number => {
		const known = best.get(id);
		if (known) return known.length;
		let via: string | null = null;
		let length = 1;
		const deps = (nodes.get(id) as DependencyGraphNode).dependencies
			.filter(usable)
			.sort(compareIds);
		for (const dep of deps) {
			const candidate = measure(dep) + 1;
			if (candidate > length) {
				length = candidate;
				via = dep;
			}
		}
		best.set(id, { length, via });
		return length;
	};

	let end: string | null = null;
	for (const id of [...nodes.keys()].filter(usable).sort(compareIds)) {
		if (end === null || measure(id) > measure(end)) end = id;
	}

	const path: string[] = [];
	for (let id = end; id !== null; id = best.get(id)?.via ?? null) {
		path.unshift(id);
	}
	return path;
}

/** Tarjan's algorithm over the nodes `include` accepts; groups of 2+ only */
function stronglyConnected(
	nodes: Map<string, DependencyGraphNode>,
	include: (node: DependencyGraphNode) => boolean
): string[][] {
	const index = new Map<string, number>();
	const low = new Map<string, number>();
	const onStack = new Set<string>();
	const stack: string[] = [];
	const groups: string[][] = [];
	let counter = 0;

	const visit = (id: string): void => {
		index.set(id, counter);
		low.set(id, counter);
		counter++;
		stack.push(id);
		onStack.add(id);

		const node = nodes.get(id) as DependencyGraphNode;
		for (const dep of node.dependencies) {
			if (!include(nodes.get(dep) as DependencyGraphNode)) continue;
			if (!index.has(dep)) {
				visit(dep);
				low.set(id, Math.min(low.get(id) as number, low.get(dep) as number));
			} else if (onStack.has(dep)) {
				low.set(id, Math.min(low.get(id) as number, index.get(dep) as number));
			}
		}

		if (low.get(id) === index.get(id)) {
			const group: string[] = [];
			let member: string;
			do {
				member = stack.pop() as string;
				onStack.delete(member);
				group.push(member);
			} while (member !== id);
			if (group.length > 1) groups.push(group.sort(compareIds));
		}
	};

	for (const node of nodes.values()) {
		if (include(node) && !index.has(node.id)) visit(node.id);
	}
	return groups.sort((a, b) => compareIds(a[0], b[0]));
}
