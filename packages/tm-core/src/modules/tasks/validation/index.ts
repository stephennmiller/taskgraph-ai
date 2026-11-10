/**
 * @fileoverview Task validation utilities and Zod schemas
 */

export {
	TASK_ID_PATTERN,
	isValidTaskIdFormat,
	taskIdSchema,
	taskIdsSchema,
	parseTaskIds,
	extractParentId,
	isSubtaskId,
	fullSubtaskId,
	normalizeTaskId
} from './task-id.js';
export {
	assertNoNewTaskProblems,
	findStoredTaskProblems,
	knownTaskProblems,
	type StoredTaskProblem
} from './stored-tasks.js';
