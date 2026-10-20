/**
 * @fileoverview Explains why a task can't be started: follows its unfinished
 * dependencies down to the root causes. Pure; see dependency-graph.ts for how
 * tasks, subtasks and missing IDs are read.
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

export interface BlockerRootCause {
	id: string;
	title?: string;
	status?: TaskStatus;
	kind: BlockerKind;
	/** For `cycle`: every task in the loop */
	cycle?: string[];
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
		if (!rootCauses.has(key)) rootCauses.set(key, cause);
	};

	const unfinished = (node: DependencyGraphNode) =>
		node.dependencies
			.map((d) => nodes.get(d) as DependencyGraphNode)
			.filter((d) => !isTaskComplete(d.status))
			.sort((a, b) => compareIds(a.id, b.id));

	const explain = (
		node: DependencyGraphNode,
		path: string[]
	): BlockerNode[] => {
		const blockers: BlockerNode[] = [];

		for (const dep of unfinished(node)) {
			if (path.includes(dep.id)) {
				const cycle = cycles.find((c) => c.includes(dep.id)) ?? [dep.id];
				addCause({
					id: dep.id,
					title: dep.title,
					status: dep.status,
					kind: 'cycle',
					cycle
				});
				blockers.push({
					id: dep.id,
					title: dep.title,
					status: dep.status,
					kind: 'cycle',
					blockers: []
				});
				continue;
			}

			if (expanded.has(dep.id)) {
				blockers.push({
					id: dep.id,
					title: dep.title,
					status: dep.status,
					kind: kinds.get(dep.id),
					blockers: [],
					repeated: true
				});
				continue;
			}

			expanded.add(dep.id);
			const below = explain(dep, [...path, dep.id]);
			const kind: BlockerKind | undefined = below.length
				? undefined
				: STALLED.includes(dep.status)
					? 'stalled'
					: 'ready';
			kinds.set(dep.id, kind);
			if (kind) {
				addCause({
					id: dep.id,
					title: dep.title,
					status: dep.status,
					kind
				});
			}
			blockers.push({
				id: dep.id,
				title: dep.title,
				status: dep.status,
				kind,
				blockers: below
			});
		}

		for (const missing of [...node.missing].sort(compareIds)) {
			addCause({ id: missing, kind: 'missing' });
			blockers.push({ id: missing, kind: 'missing', blockers: [] });
		}

		return blockers;
	};

	const blockers = isTaskComplete(target.status)
		? []
		: explain(target, [target.id]);

	return {
		id: target.id,
		title: target.title,
		status: target.status,
		blocked: blockers.length > 0,
		blockers,
		rootCauses: [...rootCauses.values()]
	};
}
