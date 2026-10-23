import { stripVTControlCharacters as plain } from 'node:util';
import type { PrdDelta } from '@tm/core';
import { describe, expect, it } from 'vitest';
import { formatPrdDelta } from './prd-delta-formatters.js';

const lines = (text: string) => plain(text).split('\n');

const section = (slug: string) => ({
	slug,
	title: slug,
	level: 2,
	line: 1,
	text: `## ${slug}`
});

const delta = (overrides: Partial<PrdDelta> = {}): PrdDelta => ({
	path: 'docs/prd.md',
	added: [],
	changed: [],
	removed: [],
	unchanged: 8,
	known: true,
	...overrides
});

describe('formatPrdDelta', () => {
	it('says an unchanged PRD adds nothing, in one line', () => {
		expect(lines(formatPrdDelta(delta(), 80))).toEqual([
			'✓ docs/prd.md is unchanged since its tasks were made · no tasks added'
		]);
	});

	it('prints one line per group', () => {
		const output = formatPrdDelta(
			delta({
				added: [section('two-factor-sign-in'), section('exports')],
				changed: [{ slug: 'search--tags', title: 'Search', taskIds: [9, 4] }],
				removed: [{ slug: 'rate-limiting', taskIds: [7] }]
			}),
			80
		);

		expect(lines(output)).toEqual([
			'2 new sections in docs/prd.md · #two-factor-sign-in, #exports',
			'⚠ 1 changed section · #search--tags · may be stale: tasks 4, 9',
			'⚠ 1 removed section · #rate-limiting · task 7 cites it'
		]);
	});

	it('says no tasks are added when sections only changed or went away', () => {
		const output = formatPrdDelta(
			delta({
				changed: [{ slug: 'overview', title: 'Overview', taskIds: [] }],
				removed: [
					{ slug: 'a', taskIds: [3] },
					{ slug: 'b', taskIds: [5] }
				]
			}),
			80
		);

		expect(lines(output)).toEqual([
			'✓ No new sections in docs/prd.md · no tasks added',
			'⚠ 1 changed section · #overview',
			'⚠ 2 removed sections · #a, #b · tasks 3, 5 cite them'
		]);
	});

	it('cuts long lists to fit the width', () => {
		const many = Array.from({ length: 30 }, (_, i) => `section-number-${i}`);
		const output = formatPrdDelta(
			delta({
				added: many.map(section),
				changed: many.map((slug, i) => ({ slug, title: slug, taskIds: [i] }))
			}),
			80
		);

		for (const line of lines(output)) {
			expect(line.length).toBeLessThanOrEqual(80);
		}
		expect(lines(output)[0]).toMatch(/\+\d+ more$/);
		expect(lines(output)[1]).toContain('tasks 0, 1, 2, 3, 4 +25 more');
	});
});
