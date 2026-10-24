/**
 * task-manager.js
 * Task management functions for the TaskGraph CLI
 */

import analyzeTaskComplexity from './task-manager/analyze-task-complexity.js';
import findNextTask from './task-manager/find-next-task.js';
import parsePRD from './task-manager/parse-prd/index.js';
import setResponseLanguage from './task-manager/response-language.js';
import {
	scopeDownTask,
	scopeUpTask,
	validateStrength
} from './task-manager/scope-adjustment.js';
import taskExists from './task-manager/task-exists.js';
import updateSubtaskById from './task-manager/update-subtask-by-id.js';
import updateTaskById from './task-manager/update-task-by-id.js';
import updateTasks from './task-manager/update-tasks.js';
import { findTaskById } from './utils.js';

// Export task manager functions
export {
	parsePRD,
	updateTasks,
	updateTaskById,
	updateSubtaskById,
	findNextTask,
	analyzeTaskComplexity,
	findTaskById,
	taskExists,
	setResponseLanguage,
	scopeUpTask,
	scopeDownTask,
	validateStrength
};
