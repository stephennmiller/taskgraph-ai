import { UPSTREAM_DIR } from '@tm/core';
import { describe, expect, it } from 'vitest';
import {
	type UpstreamImportSummary,
	formatUpstreamImport
} from './upstream-import-formatters.js';

// Strip ANSI codes so assertions read like the terminal does
const dir = `${UPSTREAM_DIR}/`;
const plain = (text: string) => text.replace(/\u001b\[[0-9;]*m/g, '');

const imported: UpstreamImportSummary = {
	result: {
		tags: [
			{ name: 'master', tasks: 3 },
			{ name: 'feature-auth', tasks: 1 }
		],
		taskCount: 4,
		copiedFiles: { docs: 2, reports: 2, templates: 1 },
		droppedModels: [
			{ role: 'research', provider: 'perplexity', modelId: 'sonar-pro' }
		],
		droppedSettings: [
			'global.ollamaBaseURL',
			'global.bedrockBaseURL',
			'global.azureBaseURL',
			'global.vertexProjectId',
			'global.anthropicApiKey',
			'global.userId'
		]
	},
	changes: [
		{ path: '.gitignore', note: 'created' },
		{ path: '.env.example', note: 'optional settings' }
	]
};

describe('formatUpstreamImport', () => {
	it('leads with what moved, then the other files, then the next step', () => {
		const lines = plain(formatUpstreamImport(imported)).split('\n');

		expect(lines).toEqual([
			`✓ Imported 4 tasks in 2 tags, docs, reports and templates from ${dir}`,
			'  .gitignore    created',
			'  .env.example  optional settings',
			'Skipped the research model (perplexity sonar-pro) and 6 provider settings',
			`${dir} is unchanged · Next: taskgraph next`
		]);
	});

	it('fits every line in 80 columns', () => {
		const lines = plain(formatUpstreamImport(imported)).split('\n');

		for (const line of lines) expect(line.length).toBeLessThanOrEqual(80);
	});

	it('names only the roles when several models were skipped', () => {
		const text = plain(
			formatUpstreamImport({
				...imported,
				result: {
					...imported.result,
					droppedModels: [
						{ role: 'main', provider: 'openai', modelId: 'gpt-4o' },
						{ role: 'research', provider: 'perplexity', modelId: 'sonar' }
					],
					droppedSettings: []
				}
			})
		);

		expect(text).toContain('Skipped the main and research models\n');
	});

	it('says nothing was skipped by leaving the line out', () => {
		const text = plain(
			formatUpstreamImport({
				...imported,
				result: { ...imported.result, droppedModels: [], droppedSettings: [] }
			})
		);

		expect(text).not.toContain('Skipped');
	});

	it('uses singular words for one task in one tag', () => {
		const first = plain(
			formatUpstreamImport({
				result: {
					tags: [{ name: 'master', tasks: 1 }],
					taskCount: 1,
					copiedFiles: { docs: 0, reports: 0, templates: 0 },
					droppedModels: [],
					droppedSettings: ['global.userId']
				},
				changes: []
			})
		).split('\n');

		expect(first).toEqual([
			`✓ Imported 1 task from ${dir}`,
			'Skipped 1 provider setting',
			`${dir} is unchanged · Next: taskgraph next`
		]);
	});

	it('points at parse-prd when the upstream folder had no tasks', () => {
		const text = plain(
			formatUpstreamImport({
				result: {
					tags: [],
					taskCount: 0,
					copiedFiles: { docs: 1, reports: 0, templates: 0 },
					droppedModels: [],
					droppedSettings: []
				},
				changes: []
			})
		);

		expect(text).toBe(
			`✓ Imported docs from ${dir}\n${dir} is unchanged · Next: taskgraph parse-prd`
		);
	});
});
