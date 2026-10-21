/**
 * @fileoverview Dependency graph analysis: pure functions over a task list.
 *
 * Tasks and subtasks are flattened into one graph keyed by task ID (subtasks
 * use dotted IDs like "2.1"). What a subtask's dependency names follows
 * `resolveSubtaskDependency`: a bare number is a sibling (1 under task 2 is
 * "2.1"), a string without a dot is a task. A parent task is not an edge to
 * its subtasks: finishing the subtasks does not unblock anything by itself.
 *
 * Dependency IDs that match no task are recorded as `missing` and never become
 * edges. Self-dependencies are not edges either (the analyses ignore them),
 * but are flagged on the node as `selfDependency`.
 *
 * Finished means `isTaskComplete` (done, completed, cancelled). Finished
 * tasks take no part in `blockedCount`, `bottlenecks` or `criticalPath`. Every
 * other status, including deferred, blocked and review, is open: it still
 * stands in the way of its dependents.
 *
 * Cycles: `findCycles` returns strongly connected groups of 2+ tasks, over
 * every task. That deliberately differs from `buildDependencyTree`'s
 * `cyclic`, which also lists everything downstream of a loop. `criticalPath`
 * leaves cycle members out, since a loop can't be started, and ignores edges
 * to them.
 *
 * Everything is iterative, so long chains don't overflow the stack.
 */

import { isTaskComplete } from '../../common/constants/index.js';
import type { Task, TaskStatus } from '../../common/types/index.js';
import { resolveSubtaskDependency } from './subtask-dependency.js';

export interface DependencyGraphNode {
	id: string;
	title: string;
	status: TaskStatus;
	priority?: Task['priority'];
	/** Dependency IDs that match a task (excluding the task itself) */
	dependencies: string[];
	/** Dependency IDs that don't match any task */
	missing: string[];
	/** The task lists itself as a dependency (not an edge; see header) */
	selfDependency: boolean;
	/** IDs of tasks that list this one as a dependency */
	dependents: string[];
}

export interface DependencyGraph {
	/** Every task and subtask by ID, parents before their subtasks */
	nodes: Map<string, DependencyGraphNode>;
}

export interface Bottleneck {
	id: string;
	title: string;
	status: TaskStatus;
	/** Unfinished tasks waiting on this one, transitively */
	blocks: number;
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
				deps: (sub.dependencies ?? []).map((d) =>
					resolveSubtaskDependency(id, d)
				)
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
			selfDependency: false,
			dependents: []
		});
	}
	for (const r of raw) {
		const node = nodes.get(r.id) as DependencyGraphNode;
		for (const dep of new Set(r.deps)) {
			if (dep === r.id) {
				node.selfDependency = true;
				continue;
			}
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
 * counts itself. One pass over the condensed graph with a bitset per
 * component, so memory grows with the square of the number of open tasks
 * (about 12 MB at 10k).
 */
export function blockedCount(tasks: Task[]): Map<string, number> {
	const { nodes } = buildDependencyGraph(tasks);
	const counts = new Map<string, number>();
	const open: string[] = [];
	for (const node of nodes.values()) {
		if (isOpen(node)) open.push(node.id);
		else counts.set(node.id, 0);
	}

	// Components come out with everything they block already emitted
	const components = stronglyConnectedComponents(
		open,
		(id) => (nodes.get(id) as DependencyGraphNode).dependents,
		(id) => isOpen(nodes.get(id) as DependencyGraphNode)
	);
	const componentOf = new Map<string, number>();
	components.forEach((members, c) => {
		for (const id of members) componentOf.set(id, c);
	});

	const words = Math.ceil(components.length / 32);
	const reach: Uint32Array[] = [];
	components.forEach((members, c) => {
		const bits = new Uint32Array(words);
		for (const id of members) {
			for (const next of (nodes.get(id) as DependencyGraphNode).dependents) {
				const d = componentOf.get(next);
				if (d === undefined || d === c) continue;
				bits[d >> 5] |= 1 << (d & 31);
				const below = reach[d];
				for (let w = 0; w < words; w++) bits[w] |= below[w];
			}
		}
		let total = members.length - 1;
		for (let d = 0; d < c; d++) {
			if (bits[d >> 5] & (1 << (d & 31))) total += components[d].length;
		}
		reach.push(bits);
		for (const id of members) counts.set(id, total);
	});
	return counts;
}

/**
 * The open tasks that hold up the most work, most first. Ties go to the
 * lowest ID. Tasks that block nothing are left out; pass `limit` to keep the
 * top few. Plain data, safe to serialize.
 */
export function bottlenecks(tasks: Task[], limit?: number): Bottleneck[] {
	const { nodes } = buildDependencyGraph(tasks);
	const ranked: Bottleneck[] = [];
	for (const [id, blocks] of blockedCount(tasks)) {
		const node = nodes.get(id) as DependencyGraphNode;
		if (blocks > 0 && isOpen(node)) {
			ranked.push({ id, title: node.title, status: node.status, blocks });
		}
	}
	ranked.sort((a, b) => b.blocks - a.blocks || compareIds(a.id, b.id));
	return limit === undefined ? ranked : ranked.slice(0, Math.max(0, limit));
}

/**
 * Tasks in dependency cycles, one sorted group per cycle (strongly connected
 * component), groups sorted by their first ID. Considers every task, finished
 * or not.
 */
export function findCycles(tasks: Task[]): string[][] {
	const { nodes } = buildDependencyGraph(tasks);
	return stronglyConnectedComponents(
		[...nodes.keys()],
		(id) => (nodes.get(id) as DependencyGraphNode).dependencies
	)
		.filter((group) => group.length > 1)
		.map((group) => group.sort(compareIds))
		.sort((a, b) => compareIds(a[0], b[0]));
}

/**
 * Longest chain of unfinished work, dependencies first. Tasks in a cycle are
 * left out (they can't be ordered), as are missing dependencies. Ties go to
 * the lowest IDs. Empty when nothing is left to do.
 */
export function criticalPath(tasks: Task[]): string[] {
	const { nodes } = buildDependencyGraph(tasks);
	const open = [...nodes.values()].filter(isOpen).map((n) => n.id);
	const isOpenId = (id: string) => isOpen(nodes.get(id) as DependencyGraphNode);
	const cyclic = new Set(
		stronglyConnectedComponents(
			open,
			(id) => (nodes.get(id) as DependencyGraphNode).dependencies,
			isOpenId
		)
			.filter((group) => group.length > 1)
			.flat()
	);
	const usable = open.filter((id) => !cyclic.has(id));
	const usableDeps = (id: string) =>
		(nodes.get(id) as DependencyGraphNode).dependencies.filter(
			(d) => isOpenId(d) && !cyclic.has(d)
		);

	// Topological order (dependencies first), then longest chain ending at each
	const waiting = new Map<string, number>();
	for (const id of usable) waiting.set(id, usableDeps(id).length);
	const order = usable.filter((id) => waiting.get(id) === 0);
	for (let i = 0; i < order.length; i++) {
		for (const dependent of (nodes.get(order[i]) as DependencyGraphNode)
			.dependents) {
			if (!waiting.has(dependent)) continue;
			const left = (waiting.get(dependent) as number) - 1;
			waiting.set(dependent, left);
			if (left === 0) order.push(dependent);
		}
	}

	const best = new Map<string, { length: number; via: string | null }>();
	let end: string | null = null;
	for (const id of order) {
		let length = 1;
		let via: string | null = null;
		for (const dep of usableDeps(id)) {
			const candidate = (best.get(dep) as { length: number }).length + 1;
			if (
				candidate > length ||
				(candidate === length && via !== null && compareIds(dep, via) < 0)
			) {
				length = candidate;
				via = dep;
			}
		}
		best.set(id, { length, via });
		const bestEnd = end === null ? null : (best.get(end) as { length: number });
		if (
			bestEnd === null ||
			length > bestEnd.length ||
			(length === bestEnd.length && compareIds(id, end as string) < 0)
		) {
			end = id;
		}
	}

	const path: string[] = [];
	for (let id = end; id !== null; id = best.get(id)?.via ?? null) {
		path.unshift(id);
	}
	return path;
}

/**
 * Iterative Tarjan over the listed nodes, following `next` edges to nodes
 * `include` accepts. Returns every component (singletons too); a component is
 * emitted only after every component reachable from it.
 */
function stronglyConnectedComponents(
	ids: string[],
	next: (id: string) => string[],
	include: (id: string) => boolean = () => true
): string[][] {
	const index = new Map<string, number>();
	const low = new Map<string, number>();
	const onStack = new Set<string>();
	const stack: string[] = [];
	const components: string[][] = [];
	let counter = 0;

	for (const root of ids) {
		if (index.has(root)) continue;
		const work: Array<{ id: string; edges: string[]; at: number }> = [];
		const enter = (id: string) => {
			index.set(id, counter);
			low.set(id, counter);
			counter++;
			stack.push(id);
			onStack.add(id);
			work.push({ id, edges: next(id).filter(include), at: 0 });
		};
		enter(root);

		while (work.length) {
			const frame = work[work.length - 1];
			if (frame.at < frame.edges.length) {
				const to = frame.edges[frame.at++];
				if (!index.has(to)) {
					enter(to);
				} else if (onStack.has(to)) {
					low.set(
						frame.id,
						Math.min(low.get(frame.id) as number, index.get(to) as number)
					);
				}
				continue;
			}

			work.pop();
			if (low.get(frame.id) === index.get(frame.id)) {
				const group: string[] = [];
				let member: string;
				do {
					member = stack.pop() as string;
					onStack.delete(member);
					group.push(member);
				} while (member !== frame.id);
				components.push(group);
			}
			const parent = work[work.length - 1];
			if (parent) {
				low.set(
					parent.id,
					Math.min(low.get(parent.id) as number, low.get(frame.id) as number)
				);
			}
		}
	}
	return components;
}
