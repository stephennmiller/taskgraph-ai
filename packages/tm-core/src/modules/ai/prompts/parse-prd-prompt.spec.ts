/**
 * The parse-prd prompt asks for a dependency graph and a priority spread,
 * and sizes the task list to the PRD unless a count is given (#253)
 */
import { describe, expect, it } from 'vitest';
import { PromptManager } from './prompt-manager.js';

const params = {
	nextId: 1,
	prdContent: 'Users log in with a password.',
	prdPath: 'prd.txt'
};

const load = (numTasks: number, research = false) =>
	new PromptManager().loadPrompt('parse-prd', {
		...params,
		numTasks,
		research
	});

describe('parse-prd prompt: dependencies and priority', () => {
	it.each([
		[0, false],
		[0, true],
		[12, false],
		[12, true]
	])(
		'never tells the model to leave dependencies empty or give every task one priority (numTasks: %s, research: %s)',
		(numTasks, research) => {
			const { systemPrompt } = load(numTasks, research);

			expect(systemPrompt).not.toMatch(/dependencies to an empty array/i);
			expect(systemPrompt).not.toMatch(/priority to '\w*' initially/i);
			expect(systemPrompt).not.toContain('initially for all tasks');
		}
	);

	it('asks for real dependency IDs and a priority per task, with status pending', () => {
		const { systemPrompt } = load(0);

		expect(systemPrompt).toContain("Set status to 'pending' for all tasks.");
		expect(systemPrompt).toContain('6. Set appropriate dependency IDs');
		expect(systemPrompt).toContain(
			'7. Assign priority (high/medium/low) based on criticality'
		);
	});

	it('does not ask for pseudo-code', () => {
		const { systemPrompt } = load(0);

		expect(systemPrompt).not.toMatch(/pseudo-?code/i);
		expect(systemPrompt).toContain(
			'Include implementation details and test strategy for each task.'
		);
	});
});

describe('parse-prd prompt: task count', () => {
	it('lets the model size the list to the PRD when numTasks is 0', () => {
		const { systemPrompt, userPrompt } = load(0);

		expect(systemPrompt).toContain(
			'generate an appropriate number of top-level development tasks'
		);
		expect(systemPrompt).toContain(
			'create an appropriate number of tasks, numbered sequentially'
		);
		expect(userPrompt).toContain(
			'break down into an appropriate number of tasks'
		);
		for (const prompt of [systemPrompt, userPrompt]) {
			expect(prompt).not.toMatch(/approximately \d|exactly \d/);
		}
	});

	it('asks for about the requested count when numTasks is set', () => {
		const { systemPrompt, userPrompt } = load(12);

		expect(systemPrompt).toContain('generate approximately 12 top-level');
		expect(systemPrompt).toContain('create exactly 12 tasks');
		expect(userPrompt).toContain('break down into approximately 12 tasks');
	});
});

describe('parse-prd prompt: acceptance criteria and PRD sections', () => {
	it.each([false, true])(
		'asks for 2-5 criteria per task and keeps the guidelines numbered in order (research: %s)',
		(research) => {
			const { systemPrompt } = load(0, research);

			expect(systemPrompt).toContain('"acceptanceCriteria": string[]');
			expect(systemPrompt).toContain(
				'13. Give each task 2-5 acceptance criteria'
			);
			expect(systemPrompt).toContain('12. Set "section"');
			expect(systemPrompt.includes('14. For each task')).toBe(research);
			expect(systemPrompt).not.toContain('13. For each task');
		}
	);

	it('lists the sections for the AI to cite, and leaves the list out without headings', () => {
		const withSections = new PromptManager().loadPrompt('parse-prd', {
			...params,
			numTasks: 3,
			prdSections: '- authentication (Authentication)'
		});
		expect(withSections.userPrompt).toContain(
			'- authentication (Authentication)'
		);
		expect(withSections.systemPrompt).toContain('"section"');
		expect(load(3).userPrompt).not.toContain('Sections of this PRD');
	});

	it('says when only new sections are sent (#203)', () => {
		const prompt = (newSectionsOnly: boolean) =>
			new PromptManager().loadPrompt('parse-prd', {
				...params,
				numTasks: 0,
				nextId: 5,
				newSectionsOnly
			}).userPrompt;
		expect(prompt(true)).toContain('only the sections added since then');
		expect(prompt(false)).not.toContain('only the sections added');
	});
});
