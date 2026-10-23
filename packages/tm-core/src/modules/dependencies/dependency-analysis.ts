/**
 * @fileoverview One call for the graph-wide analysis the MCP
 * `dependency_analysis` tool returns: bottlenecks, critical path and
 * dependency cycles, plus an optional blocker explanation for one task. Pure;
 * see dependency-graph.ts for the rules (a subtask waits on its parent's
 * dependencies; a parent finishes after its subtasks) and known limits (cycle
 * members and tasks behind a loop are left out of the critical path).
 *
 * `cycles` are strongly connected groups (findCycles), which is narrower than
 * the `cyclic` list of the dependency tree that `taskgraph graph` prints: that
 * list also holds tasks merely downstream of a loop. The CLI graph gets its
 * bottlenecks and critical path from buildDependencyTree, not from here.
 */

import type { Task } from '../../common/types/index.js';
import {
	type BlockerExplanation,
	explainBlockers
} from './explain-blockers.js';
import {
	type Bottleneck,
	bottlenecks,
	criticalPath,
	findCycles
} from './dependency-graph.js';

/** How many bottlenecks are reported unless a limit says otherwise */
export const DEFAULT_BOTTLENECK_LIMIT = 5;

export interface DependencyAnalysis {
	/** Open tasks holding up the most work, most first */
	bottlenecks: Bottleneck[];
	/** Longest chain of unfinished work, dependencies first */
	criticalPath: string[];
	/** Groups of tasks that depend on each other in a loop */
	cycles: string[][];
	/** Why the requested task can't start; present only when an id was given */
	explanation?: BlockerExplanation;
}

export interface AnalyzeDependenciesOptions {
	/** How many bottlenecks to keep (default: DEFAULT_BOTTLENECK_LIMIT) */
	limit?: number;
	/** Also explain what blocks this task or subtask; throws if it doesn't exist */
	id?: string;
}

export function analyzeDependencies(
	tasks: Task[],
	options: AnalyzeDependenciesOptions = {}
): DependencyAnalysis {
	const analysis: DependencyAnalysis = {
		bottlenecks: bottlenecks(tasks, options.limit ?? DEFAULT_BOTTLENECK_LIMIT),
		criticalPath: criticalPath(tasks),
		cycles: findCycles(tasks)
	};
	if (options.id !== undefined) {
		analysis.explanation = explainBlockers(tasks, String(options.id));
	}
	return analysis;
}
