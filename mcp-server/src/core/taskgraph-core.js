/**
 * taskgraph-core.js
 * Central module that imports and re-exports all direct function implementations
 * for improved organization and maintainability.
 */

import { analyzeTaskComplexityDirect } from './direct-functions/analyze-task-complexity.js';
// Import direct function implementations
import { complexityReportDirect } from './direct-functions/complexity-report.js';
import { initializeProjectDirect } from './direct-functions/initialize-project.js';
import { modelsDirect } from './direct-functions/models.js';
import { nextTaskDirect } from './direct-functions/next-task.js';
import { parsePRDDirect } from './direct-functions/parse-prd.js';
import { researchDirect } from './direct-functions/research.js';
import { scopeDownDirect } from './direct-functions/scope-down.js';
import { scopeUpDirect } from './direct-functions/scope-up.js';
import { updateSubtaskByIdDirect } from './direct-functions/update-subtask-by-id.js';
import { updateTaskByIdDirect } from './direct-functions/update-task-by-id.js';
import { updateTasksDirect } from './direct-functions/update-tasks.js';

// Re-export all direct function implementations
export {
	parsePRDDirect,
	updateTasksDirect,
	updateTaskByIdDirect,
	updateSubtaskByIdDirect,
	nextTaskDirect,
	analyzeTaskComplexityDirect,
	complexityReportDirect,
	initializeProjectDirect,
	modelsDirect,
	researchDirect,
	scopeUpDirect,
	scopeDownDirect
};
