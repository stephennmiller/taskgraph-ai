/**
 * @fileoverview The Git merge driver for tasks.json (#210)
 */

export {
	type MergeConflict,
	type MergeRenumbered,
	type TasksMergeResult,
	mergeTasksJson
} from './merge-tasks-json.js';
export {
	MERGE_DRIVER_ATTRIBUTE,
	MERGE_DRIVER_NAME,
	type MergeDriverCommandOptions,
	type MergeDriverFiles,
	type MergeDriverInstallResult,
	type MergeDriverOutcome,
	NotAGitRepositoryError,
	installMergeDriver,
	isInsideGitWorkTree,
	isOnPath,
	mergeDriverCommand,
	runTasksMergeDriver
} from './merge-driver-files.js';
