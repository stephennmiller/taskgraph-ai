import { AddTaskResponseSchema } from './add-task.js';
import { ComplexityAnalysisResponseSchema } from './analyze-complexity.js';
import { ExpandTaskResponseSchema } from './expand-task.js';
import { ParsePRDClarifyResponseSchema } from './parse-prd-clarify.js';
import { UpdateSubtaskResponseSchema } from './update-subtask.js';
import { UpdateTaskResponseSchema } from './update-task.js';
import { UpdateTasksResponseSchema } from './update-tasks.js';

/** The response schema each AI command passes to the model */
export const COMMAND_SCHEMAS = {
	'update-tasks': UpdateTasksResponseSchema,
	'expand-task': ExpandTaskResponseSchema,
	'analyze-complexity': ComplexityAnalysisResponseSchema,
	'update-subtask-by-id': UpdateSubtaskResponseSchema,
	'update-task-by-id': UpdateTaskResponseSchema,
	'add-task': AddTaskResponseSchema,
	'parse-prd-clarify': ParsePRDClarifyResponseSchema
};
