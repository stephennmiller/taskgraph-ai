import { z } from 'zod';
import {
	GeneratedAcceptanceCriteriaSchema,
	SubtaskSchema
} from './base-schemas.js';

// A subtask as expand writes it: the shared shape plus its acceptance criteria.
// status is optional so a subtask the model left it off saves as pending (#1008)
export const ExpandedSubtaskSchema = SubtaskSchema.extend({
	status: z.enum(['pending', 'done']).optional(),
	acceptanceCriteria: GeneratedAcceptanceCriteriaSchema
}).strict();

export const ExpandTaskResponseSchema = z
	.object({
		subtasks: z.array(ExpandedSubtaskSchema)
	})
	.strict();
