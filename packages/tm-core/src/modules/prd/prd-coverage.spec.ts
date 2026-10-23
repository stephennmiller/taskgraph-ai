import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	MAX_PRD_BYTES,
	type PrdCoverageTask,
	checkPrdCoverage,
	computePrdCoverage,
	hasPrdCoverageGaps
} from './prd-coverage.js';
import { parsePrdSections } from './prd-sections.js';

const FIXTURES = path.join(__dirname, '../../../tests/fixtures/prd');
const prd = fs.readFileSync(path.join(FIXTURES, 'bookmarks.md'), 'utf8');
const renamed = fs.readFileSync(
	path.join(FIXTURES, 'bookmarks-renamed.md'),
	'utf8'
);

const task = (
	id: number,
	source?: string,
	status = 'pending'
): PrdCoverageTask => ({
	id,
	title: `Task ${id}`,
	status,
	...(source ? { metadata: { source } } : {})
});

/** The tasks a parse of the fixture PRD would produce */
const tasks = [
	task(1, 'prd.md#overview'),
	task(2, 'prd.md#sign-up'),
	task(3, 'prd.md#password-reset'),
	task(4, 'prd.md#bookmarks-api'),
	task(5, 'prd.md#setup-1'),
	task(6)
];

const readerFor = (content: string | null) => (prdPath: string) =>
	prdPath === 'prd.md' ? content : null;

describe('computePrdCoverage', () => {
	it('reports every heading as either covered or uncovered', () => {
		const coverage = computePrdCoverage(tasks, readerFor(prd));
		const file = coverage?.files[0];
		const all = parsePrdSections(prd).map((s) => s.slug);
		const cited = [
			'overview',
			'sign-up',
			'password-reset',
			'bookmarks-api',
			'setup-1'
		];
		// The title and Authentication contain cited sections, so they count
		const coveredByNesting = ['bookmarks', 'authentication'];
		const uncovered = file?.uncovered.map((s) => s.slug) ?? [];

		expect(file).toMatchObject({
			path: 'prd.md',
			missing: false,
			sectionCount: all.length,
			taskIds: [1, 2, 3, 4, 5],
			stale: []
		});
		expect(uncovered).toEqual(['search--tags', 'rate-limiting', 'setup']);
		expect([...cited, ...coveredByNesting, ...uncovered].sort()).toEqual(
			[...all].sort()
		);
	});

	it('reports tasks that cite a renamed heading, and the new heading as uncovered', () => {
		const coverage = computePrdCoverage(tasks, readerFor(renamed));
		const file = coverage?.files[0];

		expect(file?.stale).toEqual([{ taskId: 3, slug: 'password-reset' }]);
		expect(file?.uncovered.map((s) => s.slug)).toContain('forgotten-password');
	});

	it('counts the subsections of a cited section as covered', () => {
		const coverage = computePrdCoverage(
			[task(1, 'prd.md#authentication')],
			readerFor(prd)
		);
		const uncovered = coverage?.files[0].uncovered.map((s) => s.slug);

		expect(uncovered).not.toContain('sign-up');
		expect(uncovered).not.toContain('password-reset');
		expect(uncovered).toContain('overview');
	});

	it('lists tasks without a source, ignoring cancelled ones', () => {
		const coverage = computePrdCoverage(
			[
				...tasks,
				task(7, undefined, 'cancelled'),
				task(8, 'prd.md#search--tags', 'cancelled')
			],
			readerFor(prd)
		);

		expect(coverage?.unsourced).toEqual([{ id: 6, title: 'Task 6' }]);
		// A cancelled task doesn't cover its section
		expect(coverage?.files[0].uncovered.map((s) => s.slug)).toContain(
			'search--tags'
		);
	});

	it('reports a PRD that can no longer be read', () => {
		const coverage = computePrdCoverage(tasks, readerFor(null));

		expect(coverage?.files[0]).toMatchObject({
			missing: true,
			taskIds: [1, 2, 3, 4, 5]
		});
		expect(hasPrdCoverageGaps(coverage)).toBe(true);
	});

	it('is null when no task has a source', () => {
		expect(computePrdCoverage([task(1), task(2)], readerFor(prd))).toBeNull();
		expect(hasPrdCoverageGaps(null)).toBe(false);
	});

	it('finds no gaps when every section has a task', () => {
		const slugs = parsePrdSections(prd).map((s) => s.slug);
		const coverage = computePrdCoverage(
			slugs.map((slug, i) => task(i + 1, `prd.md#${slug}`)),
			readerFor(prd)
		);

		expect(hasPrdCoverageGaps(coverage)).toBe(false);
	});
});

describe('checkPrdCoverage', () => {
	let dir: string | undefined;
	afterEach(() => {
		if (dir) fs.rmSync(dir, { recursive: true, force: true });
		dir = undefined;
	});

	it('reads PRDs relative to the project root', () => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prd-coverage-'));
		fs.mkdirSync(path.join(dir, 'docs'));
		fs.writeFileSync(path.join(dir, 'docs/prd.md'), '# A\n\n## B\n');

		const coverage = checkPrdCoverage(
			[task(1, 'docs/prd.md#b'), task(2, 'docs/gone.md#x')],
			dir
		);

		expect(coverage?.files).toEqual([
			expect.objectContaining({
				path: 'docs/prd.md',
				missing: false,
				uncovered: []
			}),
			expect.objectContaining({ path: 'docs/gone.md', missing: true })
		]);
	});

	it('treats a source naming a directory or device as unreadable', () => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prd-coverage-'));
		fs.mkdirSync(path.join(dir, 'docs'));
		const devices = process.platform === 'win32' ? [] : ['/dev/zero#x'];

		const coverage = checkPrdCoverage(
			[task(1, 'docs#x'), ...devices.map((source, i) => task(i + 2, source))],
			dir
		);

		expect(coverage?.files.every((file) => file.missing)).toBe(true);
		expect(coverage?.files).toHaveLength(1 + devices.length);
	});

	it('treats a file over the size limit as unreadable', () => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prd-coverage-'));
		fs.writeFileSync(path.join(dir, 'big.md'), '');
		fs.truncateSync(path.join(dir, 'big.md'), MAX_PRD_BYTES + 1);

		const coverage = checkPrdCoverage([task(1, 'big.md#x')], dir);

		expect(coverage?.files[0]).toMatchObject({ path: 'big.md', missing: true });
	});
});
