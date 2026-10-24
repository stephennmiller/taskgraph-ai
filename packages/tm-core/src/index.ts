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
 * const { tasks } = await tmcore.tasks.list();
 * await tmcore.git.createCommit('feat: add feature');
 * const modelConfig = tmcore.config.getModelConfig();
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

// Keep changes other processes saved while a command waited before saving
export {
	mergeTagChanges,
	type MergeTagChangesResult,
	type RenumberedItem
} from './modules/storage/adapters/file-storage/merge-tag-changes.js';

// Stamp tasks.json tags with the schema version, for writers outside FileStorage
export {
	CURRENT_SCHEMA_VERSION,
	stampTasksFileSchemaVersion
} from './modules/storage/adapters/file-storage/schema-version.js';

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

// PRD sections, coverage and clarifications (parse-prd, validate-dependencies)
export * from './modules/prd/index.js';

// Scoring generated plans (npm run evals)
export * from './modules/evals/index.js';

// Importing the upstream project TaskGraph was forked from (init flag)
export * from './modules/migration/index.js';

// The project summary AI calls get instead of exploring the repo
export * from './modules/codebase/index.js';

// Setup checks (`taskgraph doctor`, plugin and CLI versions)
export * from './modules/setup/index.js';

// Zod schemas for validation
export * from './common/schemas/index.js';

// ========== Domain-Specific Type Exports ==========

// Task types
export type {
	TaskListResult,
	GetTaskListOptions
} from './modules/tasks/services/task-service.js';

// Task domain result types
export type TaskWithSubtaskResult = Awaited<ReturnType<TasksDomain['get']>>;
export type { ArchiveResult } from './modules/tasks/tasks-domain.js';

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
	LoopOutputCallbacks,
	LoopTask
} from './modules/loop/index.js';
export {
	LoopDomain,
	LoopError,
	PRESET_NAMES,
	TASK_PRESETS
} from './modules/loop/index.js';
export {
	MAX_PARALLEL,
	ParallelLoopError,
	assertParallelFlags,
	parseParallelCount
} from './modules/loop/index.js';
export type {
	ParallelLoopCallbacks,
	ParallelLoopOptions,
	ParallelLoopResult,
	ParallelTask,
	ParallelTaskState
} from './modules/loop/index.js';

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
	ImportOptions,
	ImportResult,
	ImportStep,
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

// Git - Advanced
export { GitAdapter } from './modules/git/adapters/git-adapter.js';
export { CommitMessageGenerator } from './modules/git/services/commit-message-generator.js';
export * from './modules/git/merge-driver/index.js';

// Tasks - Advanced
export {
	TaskFileGeneratorService,
	type GenerateTaskFilesOptions,
	type GenerateTaskFilesResult
} from './modules/tasks/services/task-file-generator.service.js';

// Per-machine settings (.taskgraph/config.local.json)
export {
	hasPerMachineSettings,
	mergeMachineConfig,
	splitMachineConfig
} from './modules/config/services/machine-config.js';

// Per-project environment
export {
	readProjectEnv,
	type EnvMap
} from './modules/config/services/project-env.js';

// The tag names add-tag accepts
export { TAG_NAME_PATTERN } from './modules/tasks/services/tag.service.js';

// Task filtering utilities
export {
	buildBlocksMap,
	filterReadyTasks,
	filterBlockingTasks,
	filterByStatus,
	ACTIONABLE_STATUSES,
	selectNextTask,
	readTagNamesSync,
	shouldShowTagIndicator,
	shouldShowTagIndicatorForProject,
	rankNextTasks,
	subtaskInContext,
	buildPrimeContext,
	findUnnotedInProgress,
	PRIME_RULES,
	type PrimeContext,
	type PrimeTask,
	type PrimeInProgressTask,
	type PrimeRule,
	type BuildPrimeContextOptions,
	resolveClaimant,
	normalizeNoteText,
	MAX_NOTE_BYTES,
	formatNoteBlock,
	appendNote,
	noteTimes,
	hasNoteSince,
	parseNoteSince,
	type TaskNote,
	type SelectNextTaskOptions,
	type TaskClaim,
	type TaskWithBlocks,
	type InvalidDependency,
	type BuildBlocksMapResult
} from './modules/tasks/utils/index.js';

// Archive: finished tasks out of tasks.json, IDs kept reserved
export {
	DEFAULT_ARCHIVE_AFTER_DAYS,
	ARCHIVE_FILE_NAME,
	archivePathFor,
	readArchivedIdsSync,
	isArchivedReference,
	satisfyArchivedDependencies,
	liveOrArchived,
	withStoredDependencies,
	nextTaskId,
	renameArchivedTag,
	deleteArchivedTag,
	copyArchivedTag,
	type ArchivedIds
} from './modules/tasks/utils/index.js';

// Tags named after git branches
export {
	createTagFromBranch,
	resolveBranchTag,
	recordBranchTag,
	tagNameForBranch,
	type BranchTag,
	type CreateBranchTag,
	type CreateTagFromBranchResult
} from './modules/tasks/utils/index.js';

// Older status spellings ('completed') read as 'done' on load
export {
	normalizeTaskStatus,
	normalizeTaskStatuses
} from './modules/tasks/utils/index.js';

// Tag names no new tag can take, shared with the legacy tag commands
export { isReservedNewTagName } from './modules/tasks/utils/index.js';

// An AI rewrite keeps the stored fields its schema has no place for
export { keepStoredFields } from './modules/tasks/utils/index.js';

// add-subtask and move: error codes a command explains, and what a
// cross-tag move found in its way
export {
	MOVE_ERROR_CODES,
	type CrossTagConflict
} from './modules/tasks/utils/index.js';

// remove-task, remove-subtask and clear-subtasks (tasks.removeTasks and others)
export {
	splitIds,
	type ClearSubtasksResult,
	type TaskRemovalPreview
} from './modules/tasks/utils/task-removal.js';
export type { RemoveTasksResult } from './modules/tasks/services/task-removal.service.js';

// A subtask that becomes a task gets a description it can load with
export { promotedSubtaskDescription } from './modules/tasks/utils/index.js';

// Which fields of each task a listing returns
export {
	DEFAULT_TASK_FIELDS,
	parseTaskFields,
	selectTaskFields
} from './modules/tasks/utils/index.js';

// Acceptance criteria and the Definition of Done
export {
	normalizeAcceptanceCriteria,
	normalizeDefinitionOfDone,
	buildChecklist,
	applyChecklistChanges,
	checkDoneGate,
	getUncheckedCriteria,
	parseChecklistNumbers,
	setGeneratedCriteria,
	MAX_GENERATED_CRITERIA,
	MAX_GENERATED_CRITERION_LENGTH,
	type ChecklistItem,
	type TaskChecklist,
	type ChecklistChanges,
	type ChecklistFields
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

// ========== AI prompts and response schemas ==========

export {
	PromptManager,
	getPromptManager
} from './modules/ai/prompts/prompt-manager.js';
export { COMMAND_SCHEMAS } from './modules/ai/schemas/registry.js';
export { GeneratedAcceptanceCriteriaSchema } from './modules/ai/schemas/base-schemas.js';

// ========== AI Providers ==========

// Claude Code provider; it loads the AI SDKs on first call, not on import
export * from './modules/ai/providers/index.js';

// ========== AI service ==========

// Role fallback, retries and usage telemetry over the providers; the host passes config and log
export * from './modules/ai/ai-service.js';

// ========== Add task ==========

export type {
	AddTaskHooks,
	AddTaskInput,
	AddTaskResult,
	AddedTaskReference
} from './modules/tasks/services/add-task.service.js';
export { ClaudeCodeSettingsSchema } from './modules/ai/claude-code-settings.js';
export {
	SUPPORTED_MODELS,
	type SupportedModel
} from './modules/ai/config-ai-host.js';

// ========== Expand ==========

export type {
	ExpandAllHooks,
	ExpandAllResult,
	ExpandOptions,
	ExpandTaskHooks,
	ExpandTaskInput,
	ExpandTaskResult
} from './modules/tasks/services/expand-task.service.js';
export {
	type AggregatedTelemetry,
	aggregateTelemetry
} from './modules/ai/aggregate-telemetry.js';

// ========== Research ==========

export type {
	ResearchExchange,
	ResearchHooks,
	ResearchInput,
	ResearchResult,
	ResearchSaveFailure,
	ResearchSaved
} from './modules/tasks/services/research.service.js';
export { isTaskOrSubtaskId } from './modules/tasks/services/research.service.js';

// ========== Analyze complexity ==========

export type {
	AnalyzeComplexityHooks,
	AnalyzeComplexityInput,
	AnalyzeComplexityResult,
	ComplexityAnalysisItem,
	ComplexityReportFile
} from './modules/tasks/services/analyze-complexity.service.js';
