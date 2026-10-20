/**
 * @fileoverview Explains why a task can't be started: follows its unfinished
 * dependencies down to the root causes. Pure; see dependency-graph.ts for how
 * tasks, subtasks and missing IDs are read. A task that lists itself as a
 * dependency is reported as a one-task cycle. Walks iteratively, so long
 * chains don't overflow the stack.
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
	deps: DependencyGraphNode[];
	at: number;
	out: BlockerNode[];
}

export function explainBlockers(tasks: Task[], id: string): BlockerExplanation {
	const { nodes } = buildDependencyGraph(tasks);
	const target = nodes.get(String(id));
	if (!target) {
		throw new Error(`Task ${id} not found`);
	}

	const cycles = findCycles(tasks);
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

	const open = (node: DependencyGraphNode): Frame => {
		const out: BlockerNode[] = [];
		if (node.selfDependency) out.push(addLoopEdge(node, node));
		const deps = node.dependencies
			.map((d) => nodes.get(d) as DependencyGraphNode)
			.filter((d) => !isTaskComplete(d.status))
			.sort((a, b) => compareIds(a.id, b.id));
		return { node, deps, at: 0, out };
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
			const dep = frame.deps[frame.at++];
			if (onPath.has(dep.id)) {
				frame.out.push(addLoopEdge(frame.node, dep));
			} else if (expanded.has(dep.id)) {
				frame.out.push({
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
				stack.push(open(dep));
			}
			continue;
		}

		for (const missing of [...frame.node.missing].sort(compareIds)) {
			addCause({ id: missing, kind: 'missing', listedBy: [frame.node.id] });
			frame.out.push({ id: missing, kind: 'missing', blockers: [] });
		}

		stack.pop();
		const parent = stack[stack.length - 1];
		if (!parent) {
			blockers = frame.out;
			break;
		}

		const node = frame.node;
		onPath.delete(node.id);
		const kind: BlockerKind | undefined = frame.out.length
			? undefined
			: STALLED.includes(node.status)
				? 'stalled'
				: 'ready';
		kinds.set(node.id, kind);
		if (kind) {
			addCause({ id: node.id, title: node.title, status: node.status, kind });
		}
		parent.out.push({
			id: node.id,
			title: node.title,
			status: node.status,
			kind,
			blockers: frame.out
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
