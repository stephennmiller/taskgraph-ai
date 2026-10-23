/**
 * @fileoverview Main UI exports
 * Organized UI system with components, formatters, display primitives, and layout helpers
 */

// High-level UI components
export * from './components/index.js';

// Status formatters
export { getStatusWithColor } from './formatters/status-formatters.js';

// Priority formatters
export { getPriorityWithColor } from './formatters/priority-formatters.js';

// Complexity formatters
export {
	complexityLevel,
	getComplexityWithColor,
	getComplexityWithScore,
	type ComplexityLevel
} from './formatters/complexity-formatters.js';

// What analyze-complexity found and what complexity-report shows
export {
	formatComplexityReport,
	formatComplexityRun,
	type ComplexityAnalysisItem,
	type ComplexityReport,
	type ComplexityRunSummary
} from './formatters/complexity-report-formatters.js';

// AI usage line shown after AI commands
export {
	formatCost,
	formatUsageLine,
	type UsageTelemetry
} from './formatters/usage-formatters.js';

// The one-line confirmation after set-status
export {
	formatStatusChanges,
	type StatusChange
} from './formatters/status-change-formatters.js';

// What archive and archive restore did
export {
	formatArchiveResult,
	formatRestoreResult,
	type ArchiveSummary,
	type ArchivedTaskRow
} from './formatters/archive-formatters.js';

// What next --claim took
export {
	formatClaim,
	type ClaimSummary
} from './formatters/claim-formatters.js';

// What loop --parallel prints
export {
	formatParallelHeader,
	formatParallelSummary,
	formatParallelTaskLines
} from './formatters/parallel-loop-formatters.js';

// The parallel-waves line under `taskgraph graph`
export { formatWaveSummary } from './formatters/wave-formatters.js';

// What expand just created
export {
	formatAddedSubtasks,
	type SubtaskSummaryItem
} from './formatters/subtask-summary-formatters.js';

// The `taskgraph --help` screen
export {
	formatHelp,
	HELP_GROUPS,
	type HelpGroup,
	type HelpRow
} from './formatters/help-formatters.js';

// What update-task, update, update-subtask and note changed
export {
	formatNoteAdded,
	formatNotesAdded,
	formatNothingToUpdate,
	formatTasksUpdated,
	formatTaskUpdated,
	type UpdatedTaskRef
} from './formatters/task-update-formatters.js';

// What parse-prd says after saving its tasks
export {
	formatParsePrdSaved,
	type ParsePrdSaved
} from './formatters/parse-prd-formatters.js';
// What parse-prd --append found changed in the PRD
export { formatPrdDelta } from './formatters/prd-delta-formatters.js';

// What parse-prd --clarify says around its questions
export {
	formatClarifyIntro,
	formatClarifyAnswer,
	formatNoClarifyQuestions,
	formatAcceptedSuggestions,
	formatClarificationsSaved,
	formatClarifyCancelled,
	type AcceptedReason,
	type ClarificationsSaved
} from './formatters/clarify-formatters.js';

// The line expand --all ends with
export {
	formatExpandAll,
	type ExpandAllSummary
} from './formatters/expand-all-formatters.js';

// Session context for coding agents (`taskgraph prime`)
export {
	formatPrimeContext,
	formatUnnotedReminder
} from './formatters/prime-formatters.js';

// What clear-subtasks removed
export {
	formatClearedSubtasks,
	type ClearedTask,
	type ClearSubtasksResult
} from './formatters/clear-subtasks-formatters.js';

// What research says around the answer
export {
	formatResearchAnswer,
	formatResearchContext,
	formatResearchSaved,
	formatResearchSaveFailed,
	sortTaskIds,
	type ResearchContextSummary,
	type ResearchSaveTarget
} from './formatters/research-formatters.js';

// What `show`, `next` and `start --dry-run` print about one task
export {
	formatNextStep,
	formatTaskDetail,
	type TaskDetailOptions
} from './formatters/task-detail-formatters.js';

// What `list` prints around its table
export {
	formatEmptyList,
	formatListNextStep,
	formatListSummary,
	formatNoNextTask,
	formatPlainTaskList,
	type ListSummaryOptions
} from './formatters/task-list-formatters.js';

// What `start` prints around a Claude Code session
export {
	formatStartFailed,
	formatStartLaunching,
	formatStartSessionEnded,
	type StartTarget
} from './formatters/start-formatters.js';

// Status-aware next steps for a task
export {
	getSuggestedActions,
	type SuggestedAction
} from './suggested-actions.js';

// What add-task confirms
export {
	formatTaskCreated,
	type CreatedTask,
	type CreatedTaskDependency
} from './formatters/task-created-formatters.js';

// Markdown and text wrapped to the terminal
export {
	fit,
	formatMarkdown,
	joinFacts,
	terminalSafe,
	visibleLength
} from './formatters/markdown-formatters.js';

// What init did and what to do next
export {
	formatInitSummary,
	type InitChange,
	type InitSummary
} from './formatters/init-summary-formatters.js';

// What init's upstream import moved
export {
	formatUpstreamImport,
	type UpstreamImportSummary
} from './formatters/upstream-import-formatters.js';

// What `taskgraph models` shows and confirms
export {
	formatModelChanges,
	formatModelChoices,
	formatModelConfiguration,
	MODEL_NOTES,
	MODEL_ROLES,
	MODEL_ROLE_ORDER,
	type ModelAssignments,
	type ModelChange,
	type ModelRoleName
} from './formatters/model-formatters.js';

// Checklist formatters (acceptance criteria, Definition of Done)
export {
	formatChecklist,
	formatChecklistUpdate,
	formatUncheckedCriteria
} from './formatters/checklist-formatters.js';

// Merge driver formatters (tasks.json across branches)
export {
	type MergeConflictRow,
	type MergeDriverSetup,
	type MergeRenumberedRow,
	formatMergeConflicts,
	formatMergeDriverSetup,
	formatMergeRenumbered
} from './formatters/merge-driver-formatters.js';

// Dependency formatters
export { formatDependenciesWithStatus } from './formatters/dependency-formatters.js';
export {
	formatDependencyCheck,
	formatDependencyFixes,
	type DependencyCounts,
	type DependencyFix,
	type DependencyIssue
} from './formatters/dependency-check-formatters.js';
export { formatPrdCoverage } from './formatters/prd-coverage-formatters.js';

// Tag formatters
export {
	formatTagCopied,
	formatTagCreated,
	formatTagDeleted,
	formatTagIndicator,
	formatTagList,
	formatTagRenamed,
	formatTagSwitched,
	type TagSummary
} from './formatters/tag-formatters.js';

// Link formatters (clickable terminal links)
export {
	createLink,
	createUrlLink,
	createTaskLink,
	supportsLinks
} from './formatters/link-formatters.js';

// Brand-colored loading spinner
export { brandSpinner, createSpinner } from './spinner.js';

// Terminal theme (brand colors)
export {
	theme,
	BRAND_COLORS,
	BANNER_GRADIENT,
	BORDER_COLOR,
	TABLE_BORDER,
	MUTED_BOX_BORDER
} from './theme.js';

// Layout helpers
export {
	getBoxWidth,
	getContentWidth,
	terminalWidth,
	truncate,
	wrapLine,
	createProgressBar
} from './layout/helpers.js';

// Display messages
// Note: displayError alias is available via namespace (ui.displayError) for backward compat
// but not exported at package level to avoid conflicts with utils/error-handler.ts
export {
	displayBanner,
	displayErrorBox,
	displayError, // Backward compatibility alias
	displaySuccess,
	displayWarning,
	displayInfo
} from './display/messages.js';

// Display tables
export { createTaskTable } from './display/tables.js';
