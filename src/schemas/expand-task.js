import { z } from 'zod';
import {
	GeneratedAcceptanceCriteriaSchema,
	SubtaskSchema
} from './base-schemas.js';

// A subtask as expand writes it: the shared shape plus its acceptance criteria
export const ExpandedSubtaskSchema = SubtaskSchema.extend({
	acceptanceCriteria: GeneratedAcceptanceCriteriaSchema
}).strict();

export const ExpandTaskResponseSchema = z
	.object({
		subtasks: z.array(ExpandedSubtaskSchema)
	})
	.strict();
