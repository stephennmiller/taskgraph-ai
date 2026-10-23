/**
 * @fileoverview CLI utilities main export
 * General-purpose utilities (non-UI)
 *
 * Note: UI-related utilities have been moved to src/ui/
 * For backward compatibility, use src/utils/ui.ts which re-exports from src/ui/
 */

// Error handling utilities
export {
	describeError,
	displayError,
	formatCommanderError,
	formatErrorMessage,
	isDebugMode,
	printError,
	type ErrorMessage
} from './error-handler.js';

// `--from-branch` git check failures
export { fromBranchError } from './from-branch-error.js';

// Versioned JSON output
export { formatJson, printJson, wantsJsonOutput } from './json-output.js';

// Auto-update utilities
export {
	checkForUpdate,
	performAutoUpdate,
	displayUpgradeNotification,
	compareVersions,
	restartWithNewVersion
} from './auto-update/index.js';

// Display helpers (command-specific helpers)
export { displayCommandHeader } from './display-helpers.js';

// Content rendering (HTML/Markdown to terminal)
export { renderContent } from './content-renderer.js';
