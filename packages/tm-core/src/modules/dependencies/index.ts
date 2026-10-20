/**
 * @fileoverview Dependencies domain
 * Dependency validation still lives in scripts/modules/dependency-manager.js
 * until it is migrated here.
 */

export {
	blockedCount,
	buildDependencyGraph,
	criticalPath,
	findCycles,
	type DependencyGraph,
	type DependencyGraphNode
} from './dependency-graph.js';
export {
	buildDependencyTree,
	type BuildDependencyTreeOptions,
	type DependencyTree,
	type DependencyTreeNode
} from './dependency-tree.js';
