/**
 * parse-prd records the PRD section each task came from (#202)
 */
import { PromptManager, hashPrdSection, parsePrdSections } from '@tm/core';
import { processTasks } from '../../../../../scripts/modules/task-manager/parse-prd/parse-prd-helpers.js';

const prd = {
	path: 'docs/prd.md',
	sections: parsePrdSections('# App\n\n## Authentication\n\n## Search\n')
};

const raw = (id, section, dependencies = []) => ({
	id,
	title: `Task ${id}`,
	description: 'Do it',
	details: '',
	testStrategy: '',
	priority: 'medium',
	dependencies,
	status: 'pending',
	section
});

describe('processTasks PRD sources', () => {
	test('stores a known section as metadata.source and drops the raw field', () => {
		const [task] = processTasks(
			[raw(1, 'authentication')],
			1,
			[],
			'medium',
			prd
		);

		expect(task.metadata).toEqual({
			source: 'docs/prd.md#authentication',
			// The section's hash, so a later --append can tell it changed (#203)
			sourceHash: hashPrdSection('## Authentication')
		});
		expect(task).not.toHaveProperty('section');
	});

	test('drops a section the PRD does not have', () => {
		const [task] = processTasks([raw(1, 'billing')], 1, [], 'medium', prd);

		expect(task.metadata).toBeUndefined();
		expect(task).not.toHaveProperty('section');
	});

	test('keeps the source next to dependency provenance', () => {
		const tasks = processTasks(
			[raw(1, 'authentication'), raw(2, 'Search', [1])],
			1,
			[],
			'medium',
			prd
		);

		expect(tasks[1].metadata).toEqual({
			source: 'docs/prd.md#search',
			sourceHash: hashPrdSection('## Search'),
			dependencySources: { 1: 'inferred' }
		});
	});
});

describe('parse-prd prompt', () => {
	test('lists the sections for the AI to cite', () => {
		const { userPrompt, systemPrompt } = new PromptManager().loadPrompt(
			'parse-prd',
			{
				numTasks: 3,
				nextId: 1,
				prdContent: '# App',
				prdPath: 'prd.md',
				prdSections: '- authentication (Authentication)'
			}
		);

		expect(userPrompt).toContain('- authentication (Authentication)');
		expect(systemPrompt).toContain('"section"');
	});

	test('leaves the list out when the PRD has no headings', () => {
		const { userPrompt } = new PromptManager().loadPrompt('parse-prd', {
			numTasks: 3,
			nextId: 1,
			prdContent: 'Plain text',
			prdPath: 'prd.md'
		});

		expect(userPrompt).not.toContain('Sections of this PRD');
	});

	test('says when only new sections are sent (#203)', () => {
		const load = (newSectionsOnly) =>
			new PromptManager().loadPrompt('parse-prd', {
				numTasks: 0,
				nextId: 5,
				prdContent: '## Export',
				prdPath: 'prd.md',
				newSectionsOnly
			}).userPrompt;

		expect(load(true)).toContain('only the sections added since then');
		expect(load(false)).not.toContain('only the sections added');
	});
});
