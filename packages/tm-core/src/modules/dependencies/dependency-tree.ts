/**
 * @fileoverview Dependency tree: lays out tasks as a forest for display.
 *
 * Each task appears exactly once. A task with several dependencies is placed
 * under the one that finishes last on the longest path (its deepest
 * dependency), so it always reads after everything it needs; the other
 * dependencies are listed on the node as `alsoNeeds`. Tasks caught in a
 * dependency cycle can't be reached from a root and are returned separately.
 *
 * The tree also carries the whole-tag analysis (bottlenecks and critical
 * path, from dependency-graph.ts; parallel waves, from parallel-waves.ts) and which dependencies were inferred by the
 * AI (dependency-provenance.ts), so a display needs no logic of its own.
 *
 * The tree holds top-level tasks only. A dependency on a subtask ("2.1")
 * places the task under that subtask's parent (task 2) when that is its
 * deepest dependency, and is always listed in `alsoNeeds`, since the parent
 * is not what it waits on.
 *
 * Known limits: bottlenecks and the critical path can name subtasks ("2.1"),
 * which then appear in those lists but not as tree nodes. A loop formed only
 * by a subtask's own dependencies (4 needs 2.1, 2.1 needs 4) is not called
 * out in the tree, which doesn't read subtask dependencies. Cycle members, and
 * tasks that depend on a loop, are left out of the critical path. The
 * analysis covers the whole tag, even when `rootId` scopes the tree.
 */

import type { Task, TaskStatus } from '../../common/types/index.js';
import {
	type Bottleneck,
	bottlenecks,
	buildDependencyGraph,
	compareIds,
	criticalPath
} from './dependency-graph.js';
import { DEFAULT_BOTTLENECK_LIMIT } from './dependency-analysis.js';
import { getDependencySource } from './dependency-provenance.js';
import { type ParallelWaves, parallelWaves } from './parallel-waves.js';

export interface DependencyTreeNode {
	id: string;
	title: string;
	status: TaskStatus;
	priority?: Task['priority'];
	/**
	 * Dependencies other than the task this node is drawn under; subtask
	 * dependencies ("2.1") are always listed
	 */
	alsoNeeds: string[];
	/** Dependency IDs that don't match any task */
	missing: string[];
	/** Dependencies (the parent included) recorded as AI-inferred */
	inferred: string[];
	/** Parallel wave (1 = can start now); null when finished or unschedulable */
	wave: number | null;
	children: DependencyTreeNode[];
}

export interface DependencyTree {
	roots: DependencyTreeNode[];
	/** Tasks in a dependency cycle (unreachable from any root) */
	cyclic: DependencyTreeNode[];
	total: number;
	/** Open tasks holding up the most work, most first (top few) */
	bottlenecks: Bottleneck[];
	/** Longest chain of unfinished work, dependencies first */
	criticalPath: string[];
	/** Which unfinished tasks can run at the same time (see parallelWaves) */
	waves: ParallelWaves;
}

export interface BuildDependencyTreeOptions {
	/** Only return the subtree under this task */
	rootId?: string;
}

export function buildDependencyTree(
	tasks: Task[],
	options: BuildDependencyTreeOptions = {}
): DependencyTree {
	const byId = new Map(tasks.map((t) => [String(t.id), t]));
	const depsOf = (t: Task) =>
		(t.dependencies ?? []).map(String).filter((d) => d !== String(t.id));
	// The tree only draws tasks: a dependency on subtask 2.1 places the task
	// after task 2, as parallelWaves orders it. Undefined when nothing matches
	const taskOf = (dep: string): string | undefined => {
		if (byId.has(dep)) return dep;
		const dot = dep.indexOf('.');
		if (dot <= 0) return undefined;
		const parent = byId.get(dep.slice(0, dot));
		const subId = dep.slice(dot + 1);
		return parent?.subtasks?.some((s) => String(s.id) === subId)
			? String(parent.id)
			: undefined;
	};
	/** Dependencies that name a task or subtask, as written */
	const listed = (t: Task) => depsOf(t).filter((d) => taskOf(d) !== undefined);
	/** The tasks those dependencies place it after (not itself) */
	const known = (t: Task) => [
		...new Set(
			listed(t)
				.map((d) => taskOf(d) as string)
				.filter((d) => d !== String(t.id))
		)
	];

	// Longest path from a root; cycles get Infinity so they never become parents.
	// Iterative, so a long chain can't overflow the stack
	const depth = new Map<string, number>();
	const depthOf = (id: string): number => {
		const cached = depth.get(id);
		if (cached !== undefined) return cached;
		const frame = (at: string) => ({
			id: at,
			deps: known(byId.get(at) as Task),
			next: 0,
			d: 0
		});
		const visiting = new Set([id]);
		const stack = [frame(id)];
		let d = 0;
		while (stack.length) {
			const top = stack[stack.length - 1];
			if (top.next < top.deps.length) {
				const dep = top.deps[top.next++];
				const depDepth = depth.get(dep);
				if (depDepth !== undefined) {
					top.d = Math.max(top.d, depDepth + 1);
				} else if (visiting.has(dep)) {
					top.d = Number.POSITIVE_INFINITY;
				} else {
					visiting.add(dep);
					stack.push(frame(dep));
				}
				continue;
			}
			stack.pop();
			visiting.delete(top.id);
			depth.set(top.id, top.d);
			d = top.d;
			const below = stack[stack.length - 1];
			if (below) below.d = Math.max(below.d, top.d + 1);
		}
		return d;
	};

	// Primary parent: the deepest finite dependency (latest ID breaks ties)
	const parentOf = new Map<string, string | null>();
	for (const task of tasks) {
		const id = String(task.id);
		const deps = known(task).filter((d) => Number.isFinite(depthOf(d)));
		const sorted = deps.sort(
			(a, b) => depthOf(a) - depthOf(b) || compareIds(a, b)
		);
		parentOf.set(id, sorted.length ? sorted[sorted.length - 1] : null);
	}

	const childrenOf = new Map<string, string[]>();
	for (const [id, parent] of parentOf) {
		if (!parent) continue;
		const siblings = childrenOf.get(parent);
		if (siblings) siblings.push(id);
		else childrenOf.set(parent, [id]);
	}

	const waves = parallelWaves(tasks);
	const placed = new Set<string>();
	const makeNode = (id: string): DependencyTreeNode => {
		placed.add(id);
		const task = byId.get(id) as Task;
		const parent = parentOf.get(id);
		return {
			id,
			title: task.title,
			status: task.status,
			priority: task.priority,
			alsoNeeds: listed(task)
				.filter((d) => d !== parent)
				.sort(compareIds),
			missing: depsOf(task).filter((d) => taskOf(d) === undefined),
			inferred: listed(task)
				.filter((d) => getDependencySource(task, d) === 'inferred')
				.sort(compareIds),
			wave: waves.waveOf[id] ?? null,
			children: []
		};
	};
	// Iterative, so a long chain can't overflow the stack
	const toNode = (id: string): DependencyTreeNode => {
		const root = makeNode(id);
		const stack = [root];
		for (let node = stack.pop(); node; node = stack.pop()) {
			node.children = (childrenOf.get(node.id) ?? [])
				.filter((c) => !placed.has(c))
				.sort(compareIds)
				.map(makeNode);
			for (const child of node.children) stack.push(child);
		}
		return root;
	};

	const isRoot = (t: Task) =>
		Number.isFinite(depthOf(String(t.id))) && !parentOf.get(String(t.id));

	const graph = buildDependencyGraph(tasks);
	const analysis = {
		bottlenecks: bottlenecks(tasks, DEFAULT_BOTTLENECK_LIMIT, graph),
		criticalPath: criticalPath(tasks, graph),
		waves
	};

	let roots: DependencyTreeNode[];
	if (options.rootId !== undefined) {
		const rootId = String(options.rootId);
		if (!byId.has(rootId)) {
			throw new Error(`Task ${rootId} not found`);
		}
		const root = toNode(rootId);
		// The parent isn't drawn when scoped, so its edge has nothing to mark
		root.inferred = root.inferred.filter((d) => d !== parentOf.get(rootId));
		roots = [root];
		return { roots, cyclic: [], total: countNodes(roots), ...analysis };
	}

	roots = tasks
		.filter(isRoot)
		.map((t) => String(t.id))
		.sort(compareIds)
		.map(toNode);

	const cyclic = tasks
		.map((t) => String(t.id))
		.filter((id) => !placed.has(id))
		.sort(compareIds)
		.map((id) => ({ ...toNode(id), children: [] }));

	return { roots, cyclic, total: tasks.length, ...analysis };
}

function countNodes(nodes: DependencyTreeNode[]): number {
	let count = 0;
	const stack = [...nodes];
	for (let node = stack.pop(); node; node = stack.pop()) {
		count++;
		for (const child of node.children) stack.push(child);
	}
	return count;
}
