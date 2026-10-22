/**
 * @fileoverview Main entry point for @tm/core
 * Provides unified access to all TaskGraph functionality through TmCore
 */

import type { TasksDomain } from './modules/tasks/tasks-domain.js';

// ========== Primary API ==========

/**
 * Create a new TmCore instance - The ONLY way to use tm-core
 *
 * @example
 * ```typescript
 * import { createTmCore } from '@tm/core';
 *
 * const tmcore = await createTmCore({
 *   projectPath: process.cwd()
 * });
 *
 * // Access domains
 * const tasks = await tmcore.tasks.list();
 * await tmcore.workflow.start({ taskId: '1' });
 * await tmcore.git.commit('feat: add feature');
 * const config = tmcore.config.get('models.main');
 * ```
 */
export { createTmCore, TmCore, type TmCoreOptions } from './tm-core.js';

// ========== Type Exports ==========

// Common types that consumers need
export type * from './common/types/index.js';

// Common interfaces
export type * from './common/interfaces/index.js';

// Storage interfaces - TagInfo, TagsWithStatsResult, and Watch types
export type {
	TagInfo,
	TagsWithStatsResult,
	WatchEvent,
	WatchEventType,
	WatchOptions,
	WatchSubscription
} from './common/interfaces/storage.interface.js';

// Storage adapters - FileStorage for direct local file access
export { FileStorage } from './modules/storage/index.js';

// File operations - for atomic file modifications
export { FileOperations } from './modules/storage/adapters/file-storage/file-operations.js';

// Constants
export * from './common/constants/index.js';

// Errors
export * from './common/errors/index.js';

// Utils
export * from './common/utils/index.js';
export * from './utils/time.utils.js';

// Task validation schemas
export * from './modules/tasks/validation/index.js';

// Dependency tree layout
export * from './modules/dependencies/index.js';
export * from './modules/dependencies/dependency-provenance.js';

// Importing a Task Master project (init --from-taskmaster)
export * from './modules/migration/index.js';

// Zod schemas for validation
export * from './common/schemas/index.js';

// ========== Domain-Specific Type Exports ==========

// Task types
export type {
	TaskListResult,
	GetTaskListOptions
} from './modules/tasks/services/task-service.js';

export type {
	StartTaskOptions,
	StartTaskResult,
	ConflictCheckResult
} from './modules/tasks/services/task-execution-service.js';

export type {
	PreflightResult,
	CheckResult
} from './modules/tasks/services/preflight-checker.service.js';

// Task domain result types
export type TaskWithSubtaskResult = Awaited<ReturnType<TasksDomain['get']>>;

// Workflow types
export type {
	StartWorkflowOptions,
	WorkflowStatus,
	NextAction
} from './modules/workflow/services/workflow.service.js';

export type {
	WorkflowPhase,
	TDDPhase,
	WorkflowContext,
	WorkflowState,
	TestResult
} from './modules/workflow/types.js';

// Git types
export type { CommitMessageOptions } from './modules/git/services/commit-message-generator.js';

// Reports types
export type {
	ComplexityReport,
	ComplexityReportMetadata,
	ComplexityAnalysis,
	TaskComplexityData
} from './modules/reports/types.js';

// Loop types
export type {
	LoopPreset,
	LoopConfig,
	LoopIteration,
	LoopResult,
	LoopOutputCallbacks
} from './modules/loop/index.js';
export { LoopDomain, PRESET_NAMES } from './modules/loop/index.js';

// GitHub Issues push
export {
	GitHubDomain,
	GhCliClient,
	renderIssue,
	planSync
} from './modules/github/index.js';
export type {
	GitHubClient,
	GitHubDomainOptions,
	GitHubLink,
	GitHubStatus,
	PullAction,
	PullOptions,
	PullPlan,
	PullResult,
	PullStep,
	PushOptions,
	PushPlan,
	PushResult,
	UnlinkResult,
	PlanStep
} from './modules/github/index.js';

// ========== Advanced API (for CLI/Extension/MCP) ==========

// Workflow - Advanced
export { WorkflowOrchestrator } from './modules/workflow/orchestrators/workflow-orchestrator.js';
export { WorkflowStateManager } from './modules/workflow/managers/workflow-state-manager.js';
export {
	WorkflowService,
	type TaskStatusUpdater,
	type WorkflowServiceOptions
} from './modules/workflow/services/workflow.service.js';
export type { SubtaskInfo } from './modules/workflow/types.js';

// Git - Advanced
export { GitAdapter } from './modules/git/adapters/git-adapter.js';
export { CommitMessageGenerator } from './modules/git/services/commit-message-generator.js';

// Tasks - Advanced
export { PreflightChecker } from './modules/tasks/services/preflight-checker.service.js';
export { TaskLoaderService } from './modules/tasks/services/task-loader.service.js';
export {
	TaskFileGeneratorService,
	type GenerateTaskFilesOptions,
	type GenerateTaskFilesResult
} from './modules/tasks/services/task-file-generator.service.js';

// Per-project environment
export {
	readProjectEnv,
	type EnvMap
} from './modules/config/services/project-env.js';

// Task filtering utilities
export {
	buildBlocksMap,
	filterReadyTasks,
	filterBlockingTasks,
	ACTIONABLE_STATUSES,
	selectNextTask,
	type TaskWithBlocks,
	type InvalidDependency,
	type BuildBlocksMapResult
} from './modules/tasks/utils/index.js';

// ========== Testing Utilities ==========

// Test fixtures for integration tests
export {
	createTask,
	createSubtask,
	createTasksFile,
	TaskScenarios,
	type TasksFile
} from './testing/index.js';
