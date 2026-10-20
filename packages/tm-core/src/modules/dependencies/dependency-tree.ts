/**
 * @fileoverview Dependency tree: lays out tasks as a forest for display.
 *
 * Each task appears exactly once. A task with several dependencies is placed
 * under the one that finishes last on the longest path (its deepest
 * dependency), so it always reads after everything it needs; the other
 * dependencies are listed on the node as `alsoNeeds`. Tasks caught in a
 * dependency cycle can't be reached from a root and are returned separately.
 */

import type { Task, TaskStatus } from '../../common/types/index.js';
import { compareIds } from './dependency-graph.js';

export interface DependencyTreeNode {
	id: string;
	title: string;
	status: TaskStatus;
	priority?: Task['priority'];
	/** Dependencies other than the parent this node is drawn under */
	alsoNeeds: string[];
	/** Dependency IDs that don't match any task */
	missing: string[];
	children: DependencyTreeNode[];
}

export interface DependencyTree {
	roots: DependencyTreeNode[];
	/** Tasks in a dependency cycle (unreachable from any root) */
	cyclic: DependencyTreeNode[];
	total: number;
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
	const known = (t: Task) => depsOf(t).filter((d) => byId.has(d));

	// Longest path from a root; cycles get Infinity so they never become parents
	const depth = new Map<string, number>();
	const visiting = new Set<string>();
	const depthOf = (id: string): number => {
		const cached = depth.get(id);
		if (cached !== undefined) return cached;
		if (visiting.has(id)) return Number.POSITIVE_INFINITY;
		visiting.add(id);
		const deps = known(byId.get(id) as Task);
		const d = deps.length ? Math.max(...deps.map(depthOf)) + 1 : 0;
		visiting.delete(id);
		depth.set(id, d);
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
		if (parent) childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), id]);
	}

	const placed = new Set<string>();
	const toNode = (id: string): DependencyTreeNode => {
		placed.add(id);
		const task = byId.get(id) as Task;
		const parent = parentOf.get(id);
		return {
			id,
			title: task.title,
			status: task.status,
			priority: task.priority,
			alsoNeeds: known(task)
				.filter((d) => d !== parent)
				.sort(compareIds),
			missing: depsOf(task).filter((d) => !byId.has(d)),
			children: (childrenOf.get(id) ?? [])
				.filter((c) => !placed.has(c))
				.sort(compareIds)
				.map(toNode)
		};
	};

	const isRoot = (t: Task) =>
		Number.isFinite(depthOf(String(t.id))) && !parentOf.get(String(t.id));

	let roots: DependencyTreeNode[];
	if (options.rootId !== undefined) {
		const rootId = String(options.rootId);
		if (!byId.has(rootId)) {
			throw new Error(`Task ${rootId} not found`);
		}
		roots = [toNode(rootId)];
		return { roots, cyclic: [], total: countNodes(roots) };
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

	return { roots, cyclic, total: tasks.length };
}

function countNodes(nodes: DependencyTreeNode[]): number {
	return nodes.reduce((n, node) => n + 1 + countNodes(node.children), 0);
}
