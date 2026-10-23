/**
 * @fileoverview Dependencies domain
 * Dependency validation still lives in scripts/modules/dependency-manager.js
 * until it is migrated here.
 */

export {
	analyzeDependencies,
	DEFAULT_BOTTLENECK_LIMIT,
	type AnalyzeDependenciesOptions,
	type DependencyAnalysis
} from './dependency-analysis.js';
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
	blockingDependencies,
	parallelWaves,
	type ParallelWaves,
	type UnscheduledReason,
	type UnscheduledTask
} from './parallel-waves.js';
export {
	explainBlockers,
	type BlockerExplanation,
	type BlockerKind,
	type BlockerNode,
	type BlockerRootCause,
	type DependencyEdge
} from './explain-blockers.js';
export {
	MAX_SIBLING_REFERENCE,
	isSiblingReference,
	resolveSubtaskDependency
} from './subtask-dependency.js';
export {
	buildDependencyTree,
	type BuildDependencyTreeOptions,
	type DependencyTree,
	type DependencyTreeNode
} from './dependency-tree.js';
export {
	findDanglingLinks,
	getLinkType,
	getTaskLinks,
	LINK_TYPES,
	parseLinkType,
	pruneTaskLinks,
	removeTaskLink,
	retargetTaskLinks,
	setTaskLink,
	type DanglingLink,
	type LinkType,
	type NonBlockingLinkType,
	type TaskLink
} from './task-links.js';
export {
	dependenciesForConvertedTask,
	dependenciesForMovedItem,
	retargetDependents,
	type ConvertedTaskDependencies
} from './task-to-subtask.js';
export {
	mergeNewTaskDependencies,
	type MergeNewTaskDependenciesOptions,
	type NewTaskDependencies
} from './new-task-dependencies.js';
