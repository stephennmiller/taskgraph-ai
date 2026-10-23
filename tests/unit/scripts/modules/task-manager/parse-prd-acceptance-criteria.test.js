/**
 * parse-prd asks the AI for acceptance criteria and stores them unchecked
 */
import { zodSchema } from 'ai';
import { describe, expect, it } from 'vitest';
import { prdResponseSchema } from '../../../../../scripts/modules/task-manager/parse-prd/parse-prd-config.js';
import { processTasks } from '../../../../../scripts/modules/task-manager/parse-prd/parse-prd-helpers.js';
import { PromptManager } from '../../../../../scripts/modules/prompt-manager.js';
import { ParsePRDResponseSchema } from '../../../../../src/schemas/parse-prd.js';

const aiTask = (id, extra = {}) => ({
	id,
	title: `Task ${id}`,
	description: 'Do it',
	details: 'How to do it',
	testStrategy: 'How to check it',
	priority: 'medium',
	dependencies: [],
	status: 'pending',
	...extra
});

describe('parse-prd response schema: acceptanceCriteria', () => {
	it('keeps the criteria the AI wrote', () => {
		const result = prdResponseSchema.parse({
			tasks: [aiTask(1, { acceptanceCriteria: ['Login works'] })]
		});

		expect(result.tasks[0].acceptanceCriteria).toEqual(['Login works']);
	});

	it('accepts a task without criteria, reading them as null', () => {
		const result = prdResponseSchema.parse({ tasks: [aiTask(1)] });

		expect(result.tasks[0].acceptanceCriteria).toBeNull();
	});

	it('does not fail the response over malformed criteria', () => {
		const result = prdResponseSchema.parse({
			tasks: [aiTask(1, { acceptanceCriteria: 'Login works' })]
		});

		expect(result.tasks[0].acceptanceCriteria).toBeNull();
	});

	it('lists the field as required in the JSON Schema sent to the model', () => {
		// OpenAI's Structured Outputs needs every property in `required`
		for (const schema of [prdResponseSchema, ParsePRDResponseSchema]) {
			const task = zodSchema(schema).jsonSchema.properties.tasks.items;

			expect(task.required).toContain('acceptanceCriteria');
		}
	});
});

describe('processTasks: acceptanceCriteria', () => {
	it('stores the criteria the AI wrote as unchecked items', () => {
		const [task] = processTasks(
			[
				aiTask(1, {
					acceptanceCriteria: [
						'A user with a valid password receives a session token',
						'  Wrong passwords are rejected  ',
						''
					]
				})
			],
			1,
			[],
			'medium'
		);

		expect(task.acceptanceCriteria).toEqual([
			{
				text: 'A user with a valid password receives a session token',
				checked: false
			},
			{ text: 'Wrong passwords are rejected', checked: false }
		]);
	});

	it('leaves the field off a task the AI gave no criteria', () => {
		const tasks = processTasks(
			[
				aiTask(1),
				aiTask(2, { acceptanceCriteria: null }),
				aiTask(3, { acceptanceCriteria: [] })
			],
			1,
			[],
			'medium'
		);

		for (const task of tasks) {
			expect(task).not.toHaveProperty('acceptanceCriteria');
		}
	});

	it('sanitizes streamed criteria the schema never saw', () => {
		// The streaming path hands processTasks partial objects without Zod
		const tasks = processTasks(
			[
				aiTask(1, {
					acceptanceCriteria: ['\x1b[31mLogin\x1b[0m works\n', 42, null]
				}),
				aiTask(2, { acceptanceCriteria: 'Login works' }),
				aiTask(3, { acceptanceCriteria: { text: 'Login works' } })
			],
			1,
			[],
			'medium'
		);

		expect(tasks[0].acceptanceCriteria).toEqual([
			{ text: 'Login works', checked: false }
		]);
		expect(tasks[1]).not.toHaveProperty('acceptanceCriteria');
		expect(tasks[2]).not.toHaveProperty('acceptanceCriteria');
	});
});

describe('parse-prd prompt: acceptanceCriteria', () => {
	const params = {
		numTasks: 0,
		nextId: 1,
		prdContent: 'Users log in with a password.',
		prdPath: 'prd.txt',
		defaultTaskPriority: 'medium'
	};

	it.each([false, true])(
		'asks for 2-5 criteria per task and keeps the guidelines numbered in order (research: %s)',
		(research) => {
			const { systemPrompt } = new PromptManager().loadPrompt('parse-prd', {
				...params,
				research
			});

			expect(systemPrompt).toContain('"acceptanceCriteria": string[]');
			expect(systemPrompt).toContain(
				'13. Give each task 2-5 acceptance criteria'
			);
			expect(systemPrompt).toContain('12. Set "section"');
			expect(systemPrompt.includes('14. For each task')).toBe(research);
			expect(systemPrompt).not.toContain('13. For each task');
		}
	);
});
