/**
 * @fileoverview The reply parse-prd asks the model for
 */

import { zodSchema } from 'ai';
import { describe, expect, it } from 'vitest';
import { ParsePrdResponseSchema } from './parse-prd.js';

const task = (id: number, extra = {}) => ({
	id,
	title: `Task ${id}`,
	description: 'Do it',
	details: 'How to do it',
	testStrategy: 'How to check it',
	priority: 'high',
	dependencies: [] as number[],
	status: 'pending',
	...extra
});

describe('ParsePrdResponseSchema', () => {
	it('accepts tasks, with or without dependencies on each other', () => {
		const result = ParsePrdResponseSchema.safeParse({
			tasks: [task(24), task(25, { dependencies: [24] })]
		});
		expect(result.success && result.data.tasks).toHaveLength(2);
	});

	it('drops a metadata object the model adds anyway', () => {
		// Tag metadata comes from the code; the prompt no longer asks for it
		const result = ParsePrdResponseSchema.safeParse({
			tasks: [task(1)],
			metadata: { projectName: 'Test Project' }
		});
		expect(result.success).toBe(true);
		expect(result.data).not.toHaveProperty('metadata');
	});

	it.each([
		['no tasks field', {}],
		['a task missing fields', { tasks: [{ id: 1, title: 'Test' }] }],
		['an unknown priority', { tasks: [task(1, { priority: 'invalid' })] }]
	])('rejects %s', (_name, reply) => {
		expect(ParsePrdResponseSchema.safeParse(reply).success).toBe(false);
	});

	it('keeps the criteria the AI wrote', () => {
		const result = ParsePrdResponseSchema.parse({
			tasks: [task(1, { acceptanceCriteria: ['Login works'] })]
		});
		expect(result.tasks[0].acceptanceCriteria).toEqual(['Login works']);
	});

	it('reads missing or malformed criteria as null instead of failing', () => {
		const result = ParsePrdResponseSchema.parse({
			tasks: [task(1), task(2, { acceptanceCriteria: 'Login works' })]
		});
		expect(result.tasks.map((t) => t.acceptanceCriteria)).toEqual([null, null]);
	});

	it('lists every property as required in the JSON Schema sent to the model', () => {
		// OpenAI's Structured Outputs needs every property in `required`
		const items = (zodSchema(ParsePrdResponseSchema).jsonSchema as any)
			.properties.tasks.items;
		expect(items.required).toContain('acceptanceCriteria');
	});
});
