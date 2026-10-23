import { z } from 'zod';

/** The most questions `parse-prd --clarify` asks (MAX_CLARIFYING_QUESTIONS in @tm/core) */
const MAX_QUESTIONS = 5;

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
		questions: z.array(ClarifyingQuestionSchema).max(MAX_QUESTIONS)
	})
	.strict();
