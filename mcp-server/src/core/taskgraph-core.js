/**
 * taskgraph-core.js
 * Central module that imports and re-exports all direct function implementations
 * for improved organization and maintainability.
 */

import { addDependencyDirect } from './direct-functions/add-dependency.js';
import { addSubtaskDirect } from './direct-functions/add-subtask.js';
import { addTagDirect } from './direct-functions/add-tag.js';
import { addTaskDirect } from './direct-functions/add-task.js';
import { analyzeTaskComplexityDirect } from './direct-functions/analyze-task-complexity.js';
// Import direct function implementations
import { clearSubtasksDirect } from './direct-functions/clear-subtasks.js';
import { complexityReportDirect } from './direct-functions/complexity-report.js';
import { copyTagDirect } from './direct-functions/copy-tag.js';
import { deleteTagDirect } from './direct-functions/delete-tag.js';
import { expandAllTasksDirect } from './direct-functions/expand-all-tasks.js';
import { expandTaskDirect } from './direct-functions/expand-task.js';
import { fixDependenciesDirect } from './direct-functions/fix-dependencies.js';
import { initializeProjectDirect } from './direct-functions/initialize-project.js';
import { listTagsDirect } from './direct-functions/list-tags.js';
import { modelsDirect } from './direct-functions/models.js';
import { moveTaskCrossTagDirect } from './direct-functions/move-task-cross-tag.js';
import { moveTaskDirect } from './direct-functions/move-task.js';
import { nextTaskDirect } from './direct-functions/next-task.js';
import { parsePRDDirect } from './direct-functions/parse-prd.js';
import { removeDependencyDirect } from './direct-functions/remove-dependency.js';
import { removeSubtaskDirect } from './direct-functions/remove-subtask.js';
import { removeTaskDirect } from './direct-functions/remove-task.js';
import { renameTagDirect } from './direct-functions/rename-tag.js';
import { researchDirect } from './direct-functions/research.js';
import { scopeDownDirect } from './direct-functions/scope-down.js';
import { scopeUpDirect } from './direct-functions/scope-up.js';
import { updateSubtaskByIdDirect } from './direct-functions/update-subtask-by-id.js';
import { updateTaskByIdDirect } from './direct-functions/update-task-by-id.js';
import { updateTasksDirect } from './direct-functions/update-tasks.js';
import { useTagDirect } from './direct-functions/use-tag.js';
import { validateDependenciesDirect } from './direct-functions/validate-dependencies.js';

// Re-export all direct function implementations
export {
	parsePRDDirect,
	updateTasksDirect,
	updateTaskByIdDirect,
	updateSubtaskByIdDirect,
	nextTaskDirect,
	expandTaskDirect,
	addTaskDirect,
	addSubtaskDirect,
	removeSubtaskDirect,
	analyzeTaskComplexityDirect,
	clearSubtasksDirect,
	expandAllTasksDirect,
	removeDependencyDirect,
	validateDependenciesDirect,
	fixDependenciesDirect,
	complexityReportDirect,
	addDependencyDirect,
	removeTaskDirect,
	initializeProjectDirect,
	modelsDirect,
	moveTaskDirect,
	moveTaskCrossTagDirect,
	researchDirect,
	addTagDirect,
	deleteTagDirect,
	listTagsDirect,
	useTagDirect,
	renameTagDirect,
	copyTagDirect,
	scopeUpDirect,
	scopeDownDirect
};
