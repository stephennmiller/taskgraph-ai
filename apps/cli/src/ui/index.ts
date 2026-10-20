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
	getComplexityWithColor,
	getComplexityWithScore
} from './formatters/complexity-formatters.js';

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

// What init did and what to do next
export {
	formatInitSummary,
	type InitChange,
	type InitSummary
} from './formatters/init-summary-formatters.js';

// Dependency formatters
export { formatDependenciesWithStatus } from './formatters/dependency-formatters.js';

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
