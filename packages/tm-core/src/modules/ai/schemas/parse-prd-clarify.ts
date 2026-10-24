import { z } from 'zod';
import { MAX_CLARIFYING_QUESTIONS } from '../../prd/clarifications.js';

const ClarifyingQuestionSchema = z
	.object({
		question: z
			.string()
			.min(1)
			.describe('One short question about a gap in the PRD'),
		suggestedAnswer: z
			.string()
			.min(1)
			.describe('The answer to assume if nobody replies')
	})
	.strict();

// What `parse-prd --clarify` asks before generating tasks
export const ParsePRDClarifyResponseSchema = z
	.object({
		questions: z.array(ClarifyingQuestionSchema).max(MAX_CLARIFYING_QUESTIONS)
	})
	.strict();
