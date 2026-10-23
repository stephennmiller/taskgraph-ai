/**
 * @fileoverview Explains why a task can't be started: follows its unfinished
 * dependencies down to the root causes. Pure; see dependency-graph.ts for how
 * tasks, subtasks and missing IDs are read. A task that lists itself as a
 * dependency is reported as a one-task cycle. Walks iteratively, so long
 * chains don't overflow the stack.
 *
 * A subtask also waits on what its parent waits on. Those blockers are drawn
 * under the parent (a node with `parentOf` set), so the tree says where they
 * come from:
 *
 *   2.1 Write the schema
 *   └─ 2 Build the API      (parentOf: "2.1")
 *      └─ 1 Set up the database  (ready)
 */

import { isTaskComplete } from '../../common/constants/index.js';
import type { Task, TaskStatus } from '../../common/types/index.js';
import {
	type DependencyGraphNode,
	buildDependencyGraph,
	compareIds,
	findCycles
} from './dependency-graph.js';

/**
 * Why a chain of blockers ends at a task:
 * - `ready`: unfinished but nothing is in its way; this is work to do
 * - `stalled`: deferred or blocked; it won't move until someone decides
 * - `missing`: the ID matches no task
 * - `cycle`: it depends, through the chain above it, on itself
 */
export type BlockerKind = 'ready' | 'stalled' | 'missing' | 'cycle';

export interface BlockerNode {
	id: string;
	/** Absent for missing IDs */
	title?: string;
	status?: TaskStatus;
	/** Set where a chain ends; absent when the task is blocked by others */
	kind?: BlockerKind;
	/** Unfinished dependencies of this task */
	blockers: BlockerNode[];
	/** Already shown elsewhere in the tree, so not expanded again */
	repeated?: boolean;
	/**
	 * Set when this node is the parent of the task above it. Its `blockers`
	 * are the parent's own blockers, which the subtask waits on too; the
	 * parent itself is not something to finish first
	 */
	parentOf?: string;
}

/** A dependency: `from` lists `to` as something it needs */
export interface DependencyEdge {
	from: string;
	to: string;
}

export interface BlockerRootCause {
	id: string;
	title?: string;
	status?: TaskStatus;
	kind: BlockerKind;
	/** For `missing`: every task that lists the ID */
	listedBy?: string[];
	/** For `cycle`: every task in the loop */
	cycle?: string[];
	/** For `cycle`: the dependencies that close a loop; removing all breaks it */
	edges?: DependencyEdge[];
}

export interface BlockerExplanation {
	id: string;
	title: string;
	status: TaskStatus;
	/** True when something unfinished or missing stands in the way */
	blocked: boolean;
	blockers: BlockerNode[];
	/** Where each chain ends, in the order first reached, each once */
	rootCauses: BlockerRootCause[];
}

const STALLED: TaskStatus[] = ['deferred', 'blocked'];

interface Frame {
	node: DependencyGraphNode;
	/** Dependencies inherited from the parent, then the listed ones */
	deps: Array<{ node: DependencyGraphNode; inherited: boolean }>;
	at: number;
	out: BlockerNode[];
	/** Blockers inherited from the parent, drawn under it */
	inheritedOut: BlockerNode[];
	/** This task is a dependency the frame below inherited from its parent */
	inherited?: boolean;
}

export function explainBlockers(tasks: Task[], id: string): BlockerExplanation {
	const graph = buildDependencyGraph(tasks);
	const { nodes } = graph;
	const target = nodes.get(String(id));
	if (!target) {
		throw new Error(`Task ${id} not found`);
	}

	const cycles = findCycles(tasks, graph);
	const rootCauses = new Map<string, BlockerRootCause>();
	const expanded = new Set<string>();
	const kinds = new Map<string, BlockerKind | undefined>();

	const addCause = (cause: BlockerRootCause) => {
		const key = cause.kind === 'cycle' ? `cycle:${cause.cycle}` : cause.id;
		const known = rootCauses.get(key);
		if (!known) {
			rootCauses.set(key, cause);
			return;
		}
		for (const by of cause.listedBy ?? []) {
			if (!known.listedBy?.includes(by)) known.listedBy?.push(by);
		}
		for (const edge of cause.edges ?? []) {
			if (!known.edges?.some((e) => e.from === edge.from && e.to === edge.to)) {
				known.edges?.push(edge);
			}
		}
	};

	const addLoopEdge = (from: DependencyGraphNode, to: DependencyGraphNode) => {
		const cycle = cycles.find((c) => c.includes(to.id)) ?? [to.id];
		addCause({
			id: to.id,
			title: to.title,
			status: to.status,
			kind: 'cycle',
			cycle,
			edges: [{ from: from.id, to: to.id }]
		});
		return {
			id: to.id,
			title: to.title,
			status: to.status,
			kind: 'cycle' as const,
			blockers: []
		};
	};

	const unfinished = (ids: string[]) =>
		ids
			.map((d) => nodes.get(d) as DependencyGraphNode)
			.filter((d) => !isTaskComplete(d.status))
			.sort((a, b) => compareIds(a.id, b.id));

	const open = (node: DependencyGraphNode): Frame => {
		const out: BlockerNode[] = [];
		const inheritedOut: BlockerNode[] = [];
		if (node.selfDependency) out.push(addLoopEdge(node, node));
		// Inherited first: they're drawn first, under the parent
		const deps: Frame['deps'] = [];
		const parent = node.parent
			? (nodes.get(node.parent) as DependencyGraphNode)
			: undefined;
		if (parent && !isTaskComplete(parent.status)) {
			// A parent on the path already shows its own blockers; only a way
			// back onto the path (a loop) is news
			const parentShown = onPath.has(parent.id);
			for (const dep of unfinished(node.inherited)) {
				if (!parentShown || onPath.has(dep.id)) {
					deps.push({ node: dep, inherited: true });
				}
			}
			if (!parentShown) {
				if (parent.selfDependency) {
					inheritedOut.push(addLoopEdge(parent, parent));
				}
				for (const missing of [...parent.missing].sort(compareIds)) {
					addCause({ id: missing, kind: 'missing', listedBy: [parent.id] });
					inheritedOut.push({ id: missing, kind: 'missing', blockers: [] });
				}
			}
		}
		for (const dep of unfinished(node.dependencies)) {
			deps.push({ node: dep, inherited: false });
		}
		return { node, deps, at: 0, out, inheritedOut };
	};

	/** Parents whose inherited blockers are already drawn */
	const parentsShown = new Set<string>();

	/** Close a frame: its blockers, with inherited ones under the parent */
	const blockersOf = (frame: Frame): BlockerNode[] => {
		if (!frame.inheritedOut.length) return frame.out;
		const parent = nodes.get(
			frame.node.parent as string
		) as DependencyGraphNode;
		// A sibling inherits the same blockers; point back instead of redrawing.
		// Drawn earlier: closed before, or an open frame below (its inherited
		// blockers come first, so they are drawn above this one)
		const drawnEarlier =
			parentsShown.has(parent.id) ||
			stack.some(
				(f) => f.node.parent === parent.id && f.inheritedOut.length > 0
			);
		const again = drawnEarlier && frame.inheritedOut.every((b) => b.repeated);
		parentsShown.add(parent.id);
		return [
			{
				id: parent.id,
				title: parent.title,
				status: parent.status,
				parentOf: frame.node.id,
				blockers: again ? [] : frame.inheritedOut,
				...(again && { repeated: true })
			},
			...frame.out
		];
	};

	if (isTaskComplete(target.status)) {
		return {
			id: target.id,
			title: target.title,
			status: target.status,
			blocked: false,
			blockers: [],
			rootCauses: []
		};
	}

	const onPath = new Set([target.id]);
	const stack: Frame[] = [open(target)];
	let blockers: BlockerNode[] = [];

	while (stack.length) {
		const frame = stack[stack.length - 1];

		if (frame.at < frame.deps.length) {
			const { node: dep, inherited } = frame.deps[frame.at++];
			const out = inherited ? frame.inheritedOut : frame.out;
			if (onPath.has(dep.id)) {
				// An inherited edge is the parent's dependency; that's what to remove
				const from = inherited
					? (nodes.get(frame.node.parent as string) as DependencyGraphNode)
					: frame.node;
				out.push(addLoopEdge(from, dep));
			} else if (expanded.has(dep.id)) {
				out.push({
					id: dep.id,
					title: dep.title,
					status: dep.status,
					kind: kinds.get(dep.id),
					blockers: [],
					repeated: true
				});
			} else {
				expanded.add(dep.id);
				onPath.add(dep.id);
				const child = open(dep);
				child.inherited = inherited;
				stack.push(child);
			}
			continue;
		}

		for (const missing of [...frame.node.missing].sort(compareIds)) {
			addCause({ id: missing, kind: 'missing', listedBy: [frame.node.id] });
			frame.out.push({ id: missing, kind: 'missing', blockers: [] });
		}

		stack.pop();
		const below = blockersOf(frame);
		const parent = stack[stack.length - 1];
		if (!parent) {
			blockers = below;
			break;
		}

		const node = frame.node;
		onPath.delete(node.id);
		const kind: BlockerKind | undefined = below.length
			? undefined
			: STALLED.includes(node.status)
				? 'stalled'
				: 'ready';
		kinds.set(node.id, kind);
		if (kind) {
			addCause({ id: node.id, title: node.title, status: node.status, kind });
		}
		(frame.inherited ? parent.inheritedOut : parent.out).push({
			id: node.id,
			title: node.title,
			status: node.status,
			kind,
			blockers: below
		});
	}

	return {
		id: target.id,
		title: target.title,
		status: target.status,
		blocked: blockers.length > 0,
		blockers,
		rootCauses: [...rootCauses.values()]
	};
}
