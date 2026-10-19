/**
 * @fileoverview Slash Commands Index
 * Exports all TaskGraph slash commands.
 */

import type { SlashCommand } from '../types.js';

// Task commands
import {
	parsePrd,
	parsePrdWithResearch,
	analyzeComplexity,
	complexityReport,
	expandTask,
	expandAllTasks,
	addTask,
	addSubtask,
	removeTask,
	removeSubtask,
	removeSubtasks,
	removeAllSubtasks,
	convertTaskToSubtask,
	addDependency,
	removeDependency,
	fixDependencies,
	validateDependencies,
	setupModels,
	viewModels,
	installTaskGraph,
	quickInstallTaskGraph,
	toReview,
	toDeferred,
	toCancelled,
	initProject,
	initProjectQuick
} from './solo/index.js';

// General commands
import {
	showTask,
	graph,
	listTasks,
	listTasksWithSubtasks,
	listTasksByStatus,
	projectStatus,
	nextTask,
	help,
	toDone,
	toPending,
	toInProgress,
	updateTask,
	updateSingleTask,
	updateTasksFromId,
	tmMain,
	smartWorkflow,
	learn,
	commandPipeline,
	autoImplementTasks,
	analyzeProject,
	syncReadme
} from './common/index.js';

/**
 * All TaskGraph slash commands
 * Add new commands here to have them automatically distributed to all profiles.
 */
export const allCommands: SlashCommand[] = [
	// Task commands
	parsePrd,
	parsePrdWithResearch,
	analyzeComplexity,
	complexityReport,
	expandTask,
	expandAllTasks,
	addTask,
	addSubtask,
	removeTask,
	removeSubtask,
	removeSubtasks,
	removeAllSubtasks,
	convertTaskToSubtask,
	addDependency,
	removeDependency,
	fixDependencies,
	validateDependencies,
	setupModels,
	viewModels,
	installTaskGraph,
	quickInstallTaskGraph,
	toReview,
	toDeferred,
	toCancelled,
	initProject,
	initProjectQuick,

	// General commands
	showTask,
	graph,
	listTasks,
	listTasksWithSubtasks,
	listTasksByStatus,
	projectStatus,
	nextTask,
	help,
	toDone,
	toPending,
	toInProgress,
	updateTask,
	updateSingleTask,
	updateTasksFromId,
	tmMain,
	smartWorkflow,
	learn,
	commandPipeline,
	autoImplementTasks,
	analyzeProject,
	syncReadme
];

// Re-export from subdirectories for direct access
export * from './solo/index.js';
export * from './common/index.js';
