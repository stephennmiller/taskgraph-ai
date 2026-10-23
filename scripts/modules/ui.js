/**
 * ui.js
 * User interface functions for the TaskGraph CLI.
 * Barrel over scripts/modules/ui/: named re-exports only.
 */

export {
	theme,
	BORDER_COLOR
} from './ui/theme.js';
export {
	displayAsciiBanner,
	displayAsciiBanner as displayBanner,
	displayTaggedTasksFYI,
	displayCurrentTagIndicator
} from './ui/banner-tags.js';
export {
	startLoadingIndicator,
	startParsePrdProgress,
	stopLoadingIndicator,
	succeedLoadingIndicator,
	failLoadingIndicator,
	warnLoadingIndicator,
	infoLoadingIndicator
} from './ui/loading.js';
export {
	createProgressBar,
	getStatusWithColor,
	formatDependenciesWithStatus,
	getComplexityWithColor
} from './ui/formatters.js';
export { displayHelp } from './ui/help.js';
export {
	displayComplexityReport,
	confirmTaskOverwrite
} from './ui/complexity.js';
export {
	displayAiUsageSummary,
	displayAddedSubtasks
} from './ui/context-analysis.js';
export {
	displayCrossTagDependencyError,
	formatTaskIdForDisplay,
	displaySubtaskMoveError,
	displayInvalidTagCombinationError,
	displayDependencyValidationHints
} from './ui/errors.js';
