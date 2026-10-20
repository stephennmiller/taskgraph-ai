/**
 * @fileoverview Dependencies domain
 * Dependency validation still lives in scripts/modules/dependency-manager.js
 * until it is migrated here.
 */

export {
	blockedCount,
	bottlenecks,
	type Bottleneck,
	buildDependencyGraph,
	criticalPath,
	findCycles,
	type DependencyGraph,
	type DependencyGraphNode
} from './dependency-graph.js';
export {
	explainBlockers,
	type BlockerExplanation,
	type BlockerKind,
	type BlockerNode,
	type BlockerRootCause,
	type DependencyEdge
} from './explain-blockers.js';
export {
	buildDependencyTree,
	type BuildDependencyTreeOptions,
	type DependencyTree,
	type DependencyTreeNode
} from './dependency-tree.js';
