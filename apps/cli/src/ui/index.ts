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

// What update-task, update and update-subtask changed
export {
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

// The line expand --all ends with
export {
	formatExpandAll,
	type ExpandAllSummary
} from './formatters/expand-all-formatters.js';

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

// What init did and what to do next
export {
	formatInitSummary,
	type InitChange,
	type InitSummary
} from './formatters/init-summary-formatters.js';

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

// Dependency formatters
export { formatDependenciesWithStatus } from './formatters/dependency-formatters.js';
export {
	formatDependencyCheck,
	formatDependencyFixes,
	type DependencyCounts,
	type DependencyFix,
	type DependencyIssue
} from './formatters/dependency-check-formatters.js';

// Tag formatters
export {
	formatTagCopied,
	formatTagCreated,
	formatTagDeleted,
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
	truncate,
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
