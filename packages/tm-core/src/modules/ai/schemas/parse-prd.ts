import { z } from 'zod';
import { GeneratedAcceptanceCriteriaSchema } from './base-schemas.js';

// The order the model sees in the JSON Schema; tm-core's TASK_PRIORITIES differs
const PRIORITIES = ['high', 'medium', 'low'] as const;

// A single task the model writes from the PRD
const ParsePrdTaskSchema = z.object({
	id: z.number(),
	title: z.string().min(1),
	description: z.string().min(1),
	details: z.string(),
	testStrategy: z.string(),
	priority: z.enum(PRIORITIES),
	dependencies: z.array(z.number()),
	status: z.string(),
	// Slug of the PRD section the task implements; checked against the PRD's
	// headings and stored as metadata.source. Models may leave it out
	section: z.string().nullable().default(null),
	acceptanceCriteria: GeneratedAcceptanceCriteriaSchema
});

// The whole reply. Tag metadata is written by the code, so the AI isn't asked for any
export const ParsePrdResponseSchema = z.object({
	tasks: z.array(ParsePrdTaskSchema)
});
