/**
 * Every property a prompt tells the model to return must be one the response
 * schema accepts: the JSON Schema sent with the call has
 * `additionalProperties: false`, so an extra key is refused or fails Zod
 * validation (issue #309: expand-task offered a "metadata" object).
 */
import { zodSchema } from 'ai';
import { PromptManager } from '../../../scripts/modules/prompt-manager.js';
import { prdResponseSchema } from '../../../scripts/modules/task-manager/parse-prd/parse-prd-config.js';
import { COMMAND_SCHEMAS } from '../../../src/schemas/registry.js';

const task = { id: 1, title: 'Login', description: 'Log in', details: 'Form' };

// [prompt id, variant, params, schema the call passes, how the prompt lists
// item fields, the array property holding the items (null: the response itself)]
const cases = [
	...['default', 'research', 'complexity-report'].map((variant) => [
		'expand-task',
		variant,
		{ task, subtaskCount: 3, nextSubtaskId: 1, expansionPrompt: 'Split it' },
		COMMAND_SCHEMAS['expand-task'],
		'bullets',
		'subtasks'
	]),
	[
		'analyze-complexity',
		'default',
		{ tasks: [task] },
		COMMAND_SCHEMAS['analyze-complexity'],
		'bullets',
		'complexityAnalysis'
	],
	[
		'parse-prd',
		'default',
		{ numTasks: 0, nextId: 1, prdContent: 'Users log in.', prdPath: 'p.md' },
		prdResponseSchema,
		'json',
		'tasks'
	],
	[
		'add-task',
		'default',
		{ prompt: 'Add logout', newTaskId: 2, existingTasks: [] },
		COMMAND_SCHEMAS['add-task'],
		'json',
		null
	],
	[
		'update-task',
		'default',
		{ task, taskJson: '{}', updatePrompt: 'Use OAuth' },
		COMMAND_SCHEMAS['update-task-by-id'],
		null,
		null
	],
	[
		'update-tasks',
		'default',
		{ tasks: [task], updatePrompt: 'Use OAuth' },
		COMMAND_SCHEMAS['update-tasks'],
		null,
		null
	]
] as const;

const names = (text: string, pattern: RegExp) =>
	[...text.matchAll(pattern)].map((m) => m.slice(1).find(Boolean) as string);

describe.each(cases)(
	'%s prompt (%s) and its response schema',
	(id, variant, params, schema, fieldStyle, itemsOf) => {
		const promptManager = new PromptManager();
		const { systemPrompt, userPrompt } = promptManager.loadPrompt(
			id,
			params,
			variant
		);
		const prompt = `${systemPrompt}\n${userPrompt}`;
		const json = zodSchema(schema).jsonSchema as any;
		const topLevel = Object.keys(json.properties);

		it('names only top-level properties the schema accepts', () => {
			// `a "subtasks" property`, `a "metadata" object`, `property named "task"`
			const named = names(
				prompt,
				/"(\w+)" (?:property|object)|property named "(\w+)"/g
			);

			expect(topLevel).toEqual(expect.arrayContaining(named));
		});

		it.runIf(fieldStyle)('lists only item fields the schema accepts', () => {
			// `- title: ...` lines, or `"title": ...` keys of the example object
			const listed =
				fieldStyle === 'bullets'
					? names(prompt, /^- (\w+): /gm)
					: names(systemPrompt, /^\s*"(\w+)": /gm);
			const item = itemsOf
				? json.properties[itemsOf].items.properties
				: json.properties;

			expect(listed.length).toBeGreaterThan(0);
			expect(Object.keys(item)).toEqual(expect.arrayContaining(listed));
		});
	}
);
