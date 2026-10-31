/**
 * @fileoverview Explains why a task can't be started: follows its unfinished
 * dependencies down to the root causes. Pure; see dependency-graph.ts for how
 * tasks, subtasks and missing IDs are read. A task that lists itself as a
 * dependency is reported as a one-task cycle. Walks iteratively, so long
 * chains don't overflow the stack.
 *
 * A parent can't finish before its subtasks, but they are only walked when
 * one is in a loop with it (#803): with 4 needing 3 and 3.1 needing 4,
 * `why 3.1` reports the loop 3, 3.1, 4 rather than "do 3".
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
import { canonicalTaskId } from '../tasks/validation/task-id.js';
import { createDependencyState } from './dependency-check.js';
import {
	type DependencyGraphNode,
	buildDependencyGraph,
	compareIds,
	findCycles
} from './dependency-graph.js';

/**
 * Why a chain of blockers ends at a task:
 * - `ready`: pending with nothing in its way; this is work to do
 * - `in-progress`: someone is already working on it
 * - `review`: finished work waiting to be accepted (set it to done)
 * - `stalled`: deferred or blocked; it won't move until someone decides
 * - `missing`: the ID matches no task
 * - `cycle`: it depends, through the chain above it, on itself
 */
export type BlockerKind =
	| 'ready'
	| 'in-progress'
	| 'review'
	| 'stalled'
	| 'missing'
	| 'cycle';

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
	/**
	 * For `missing`: the task an older spelling names ("1" for "01"), which
	 * fix-dependencies rewrites it to
	 */
	canonicalId?: string;
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

/** The kind of a chain end with this status; any other status is `ready` */
const END_KINDS = new Map<string, BlockerKind>([
	['in-progress', 'in-progress'],
	['review', 'review'],
	['deferred', 'stalled'],
	['blocked', 'stalled']
]);

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

	/** The loop each task is in */
	const loopOf = new Map<string, string[]>();
	for (const cycle of findCycles(tasks, graph)) {
		for (const member of cycle) loopOf.set(member, cycle);
	}
	const rootCauses = new Map<string, BlockerRootCause>();
	const expanded = new Set<string>();
	const kinds = new Map<string, BlockerKind | undefined>();

	const addCause = (cause: BlockerRootCause) => {
		// Loops are disjoint, so the first member names one; joining is slow
		const key = cause.kind === 'cycle' ? `cycle:${cause.cycle?.[0]}` : cause.id;
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

	/** A missing ID's root cause, with the task an older spelling names */
	const missingCause = (id: string, by: string): BlockerRootCause => {
		const canonicalId = canonicalTaskId(id);
		return {
			id,
			kind: 'missing',
			listedBy: [by],
			...(canonicalId !== undefined &&
				canonicalId !== id &&
				nodes.has(canonicalId) && { canonicalId })
		};
	};

	const addLoopEdge = (from: DependencyGraphNode, to: DependencyGraphNode) => {
		const cycle = loopOf.get(to.id) ?? [to.id];
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

	/**
	 * Open subtasks of `parent` that don't list it and close a loop through
	 * it with a dependency of their own (one through what they inherit is the
	 * parent's own loop)
	 */
	const loopingSubtasks = (parent: DependencyGraphNode) => {
		const loop = loopOf.get(parent.id);
		if (!loop) return [];
		return parent.subtasks
			.map((id) => nodes.get(id) as DependencyGraphNode)
			.filter(
				(sub) =>
					!isTaskComplete(sub.status) &&
					!sub.dependencies.includes(parent.id) &&
					sub.dependencies.some((dep) => loopOf.get(dep) === loop)
			);
	};

	const dependencyState = createDependencyState(tasks);
	/** The dependencies of `of` that still hold it up */
	const unfinished = (of: string, ids: string[]) =>
		ids
			.filter((d) => dependencyState(of, d) === 'open')
			.map((d) => nodes.get(d) as DependencyGraphNode)
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
			for (const dep of unfinished(parent.id, node.inherited)) {
				if (!parentShown || onPath.has(dep.id)) {
					deps.push({ node: dep, inherited: true });
				}
			}
			if (!parentShown) {
				if (parent.selfDependency) {
					inheritedOut.push(addLoopEdge(parent, parent));
				}
				for (const missing of [...parent.missing].sort(compareIds)) {
					addCause(missingCause(missing, parent.id));
					inheritedOut.push({ id: missing, kind: 'missing', blockers: [] });
				}
			}
		}
		for (const dep of unfinished(node.id, node.dependencies)) {
			deps.push({ node: dep, inherited: false });
		}
		// A parent can't finish before its subtasks; only one in a loop with it
		// is news (#803)
		for (const sub of loopingSubtasks(node)) {
			if (!onPath.has(sub.id)) deps.push({ node: sub, inherited: false });
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
			if (
				onPath.has(dep.id) ||
				// A parent waiting on a subtask above: remove the edge into the parent
				loopingSubtasks(dep).some((sub) => onPath.has(sub.id))
			) {
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
			addCause(missingCause(missing, frame.node.id));
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
			: (END_KINDS.get(node.status) ?? 'ready');
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
