import { stripVTControlCharacters as plain } from 'node:util';
import type { PrdCoverage } from '@tm/core';
import { describe, expect, it } from 'vitest';
import { formatPrdCoverage } from './prd-coverage-formatters.js';

const lines = (text: string) => plain(text).split('\n');

const file = (
	overrides: Partial<PrdCoverage['files'][number]> = {}
): PrdCoverage['files'][number] => ({
	path: 'docs/prd.md',
	missing: false,
	taskIds: [1, 2],
	sectionCount: 10,
	uncovered: [],
	stale: [],
	...overrides
});

describe('formatPrdCoverage', () => {
	it('prints nothing when no task records a PRD section', () => {
		expect(formatPrdCoverage(null)).toBe('');
	});

	it('says every section has a task in one line', () => {
		expect(
			lines(formatPrdCoverage({ files: [file()], unsourced: [] }))
		).toEqual(['✓ Every PRD section has a task · 10 sections in docs/prd.md']);
	});

	it('lists uncovered sections, renamed headings and tasks without a section', () => {
		const output = formatPrdCoverage({
			files: [
				file({
					uncovered: [
						{ slug: 'search--tags', title: 'Search & Tags', level: 2 },
						{ slug: 'rate-limiting', title: 'Rate limiting', level: 2 }
					],
					stale: [{ taskId: 3, slug: 'password-reset' }]
				})
			],
			unsourced: [{ id: 6, title: 'Write release notes' }]
		});

		expect(lines(output)).toEqual([
			'⚠ 2 of 10 PRD sections have no task · docs/prd.md',
			'  #search--tags   Search & Tags',
			'  #rate-limiting  Rate limiting',
			'⚠ 1 task cites a heading docs/prd.md no longer has',
			'  3  #password-reset',
			'⚠ 1 task has no PRD section',
			'  6  Write release notes'
		]);
	});

	it('reports a PRD it cannot read', () => {
		const output = formatPrdCoverage({
			files: [file({ missing: true, taskIds: [1, 2, 4] })],
			unsourced: []
		});

		expect(plain(output)).toBe(
			"⚠ Can't read docs/prd.md, which tasks 1, 2 and 4 cite"
		);
	});

	it('fits 80 columns', () => {
		const output = formatPrdCoverage(
			{
				files: [
					file({
						uncovered: [
							{ slug: 'a'.repeat(30), title: 'b'.repeat(120), level: 2 }
						]
					})
				],
				unsourced: [{ id: 12, title: 'c'.repeat(200) }]
			},
			80
		);

		for (const line of lines(output)) {
			expect(line.length).toBeLessThanOrEqual(80);
		}
	});

	it('strips control characters from task ids and titles in the task file', () => {
		const output = formatPrdCoverage(
			{
				files: [
					file({ stale: [{ taskId: '3\u001b]0;pwned\u0007', slug: 'x' }] })
				],
				unsourced: [{ id: '\u001b[2J6', title: 'Notes\u001b[31m' }]
			},
			80
		);

		expect(output).not.toMatch(/\u001b\]|\u001b\[2J|\u0007/);
		expect(lines(output)).toContain('  6  Notes');
	});
});
