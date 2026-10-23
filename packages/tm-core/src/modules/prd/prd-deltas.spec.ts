import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	type PrdDeltaTask,
	buildPrdSnapshot,
	diffPrdSections,
	getPrdSnapshot,
	hasPrdChanges,
	hashPrdSection,
	prdDeltaContent,
	prdSourceMetadata,
	withPrdSnapshot
} from './prd-deltas.js';
import { applyClarifications } from './clarifications.js';
import { type PrdSection, parsePrdSections } from './prd-sections.js';

const FIXTURES = path.join(__dirname, '../../../tests/fixtures/prd');
const read = (name: string) =>
	fs.readFileSync(path.join(FIXTURES, name), 'utf8');

/** The PRD tasks were made from, and the same PRD edited afterwards */
const before = read('bookmarks.md');
const after = read('bookmarks-v2.md');
const beforeSections = parsePrdSections(before);
const afterSections = parsePrdSections(after);

const PRD = 'docs/prd.md';

/** A task made from `slug` of the original PRD, as parse-prd stores it */
const task = (
	id: number,
	slug: string,
	status = 'pending',
	sections: PrdSection[] = beforeSections
): PrdDeltaTask => ({
	id,
	status,
	metadata: prdSourceMetadata(slug, sections, PRD)
});

/** What a parse of the original PRD produced: tasks 4 and 9 cover search */
const tasks = [
	task(1, 'overview'),
	task(2, 'sign-up'),
	task(3, 'password-reset'),
	task(4, 'search--tags'),
	task(5, 'bookmarks-api'),
	task(7, 'rate-limiting'),
	task(8, 'setup-1'),
	task(9, 'search--tags')
];
const snapshot = buildPrdSnapshot(beforeSections);

describe('diffPrdSections', () => {
	it('finds nothing to do when the PRD is unchanged', () => {
		const delta = diffPrdSections(beforeSections, PRD, tasks, snapshot);

		expect(delta).toMatchObject({
			added: [],
			changed: [],
			removed: [],
			unchanged: beforeSections.length,
			known: true
		});
		expect(hasPrdChanges(delta)).toBe(false);
	});

	it('reports added, changed and removed sections against the snapshot', () => {
		const delta = diffPrdSections(afterSections, PRD, tasks, snapshot);

		expect(delta.added.map((s) => s.slug)).toEqual(['two-factor-sign-in']);
		expect(delta.changed).toEqual([
			{ slug: 'search--tags', title: 'Search & Tags', taskIds: [4, 9] }
		]);
		expect(delta.removed).toEqual([{ slug: 'rate-limiting', taskIds: [7] }]);
		expect(delta.unchanged).toBe(afterSections.length - 2);
	});

	it("doesn't offer again a section that got no task the first time", () => {
		// `setup` was in the PRD when it was parsed, but no task cites it
		const delta = diffPrdSections(beforeSections, PRD, tasks, snapshot);

		expect(delta.added.map((s) => s.slug)).not.toContain('setup');
	});

	it('reports a changed section once: the next snapshot is the new baseline', () => {
		const delta = diffPrdSections(
			afterSections,
			PRD,
			tasks,
			buildPrdSnapshot(afterSections)
		);

		expect(hasPrdChanges(delta)).toBe(false);
	});

	it('lists a removed section no task cited, with no tasks', () => {
		const delta = diffPrdSections(
			afterSections,
			PRD,
			tasks.filter((t) => t.id !== 7),
			snapshot
		);

		expect(delta.removed).toEqual([{ slug: 'rate-limiting', taskIds: [] }]);
	});

	it('ignores cancelled tasks and tasks from another PRD', () => {
		const delta = diffPrdSections(
			afterSections,
			PRD,
			[
				task(4, 'search--tags', 'cancelled'),
				task(9, 'search--tags'),
				{ id: 10, metadata: { source: 'other.md#search--tags' } }
			],
			snapshot
		);

		expect(delta.changed).toEqual([
			{ slug: 'search--tags', title: 'Search & Tags', taskIds: [9] }
		]);
	});

	describe('repeated headings', () => {
		const twoSetups =
			'# App\n\n## Web\n\n### Setup\n\nInstall node.\n\n## Mobile\n\n### Setup\n\nInstall Xcode.\n';
		const recorded = buildPrdSnapshot(parsePrdSections(twoSetups));

		it('offers a "Setup" inserted above others as new, not the ones it shifted', () => {
			// The new Setup takes `setup`; the old ones move to `setup-1`, `setup-2`
			const sections = parsePrdSections(
				'# App\n\n## CLI\n\n### Setup\n\nInstall brew.\n\n## Web\n\n### Setup\n\nInstall node.\n\n## Mobile\n\n### Setup\n\nInstall Xcode.\n'
			);

			const delta = diffPrdSections(sections, PRD, [], recorded);

			expect(delta.added.map((s) => s.text)).toEqual([
				'## CLI',
				'### Setup\n\nInstall brew.'
			]);
			expect(delta.changed).toEqual([]);
			expect(delta.removed).toEqual([]);
		});

		it('reports the first of two "Setup" sections as removed, not changed', () => {
			const sections = parsePrdSections(
				'# App\n\n## Web\n\n## Mobile\n\n### Setup\n\nInstall Xcode.\n'
			);

			const delta = diffPrdSections(sections, PRD, [], recorded);

			expect(delta.added).toEqual([]);
			expect(delta.changed).toEqual([]);
			expect(delta.removed.map((r) => r.slug)).toEqual(['setup']);
		});

		it('does the same from task hashes when the tag has no snapshot', () => {
			const old = parsePrdSections(twoSetups);
			const sections = parsePrdSections(
				'# App\n\n## CLI\n\n### Setup\n\nInstall brew.\n\n## Web\n\n### Setup\n\nInstall node.\n\n## Mobile\n\n### Setup\n\nInstall Xcode.\n'
			);

			const delta = diffPrdSections(sections, PRD, [
				task(1, 'setup', 'pending', old),
				task(2, 'setup-1', 'pending', old)
			]);

			expect(delta.added.map((s) => s.text)).toContain(
				'### Setup\n\nInstall brew.'
			);
			expect(delta.added.map((s) => s.slug)).not.toContain('setup-2');
			expect(delta.changed).toEqual([]);
		});
	});

	it('handles headings named like Object properties after a JSON round trip', () => {
		const prd = '# __proto__\n\nx\n\n# Constructor\n';
		const recorded = JSON.parse(
			JSON.stringify(buildPrdSnapshot(parsePrdSections(prd)))
		);

		const delta = diffPrdSections(
			parsePrdSections(`${prd}\n# toString\n`),
			PRD,
			[],
			recorded
		);

		expect(Object.getPrototypeOf(recorded)).toBe(Object.prototype);
		expect(delta.added.map((s) => s.slug)).toEqual(['tostring']);
		expect(delta.unchanged).toBe(2);
	});

	describe('without a snapshot', () => {
		it('treats every section as new when no task cites the PRD', () => {
			const delta = diffPrdSections(afterSections, PRD, [], undefined);

			expect(delta.known).toBe(false);
			expect(delta.added).toHaveLength(afterSections.length);
			expect(prdDeltaContent(delta, after)).toBe(after);
		});

		it('uses the hashes tasks recorded, and the sections around cited ones', () => {
			const delta = diffPrdSections(afterSections, PRD, tasks, undefined);

			expect(delta.changed).toEqual([
				{ slug: 'search--tags', title: 'Search & Tags', taskIds: [4, 9] }
			]);
			expect(delta.removed).toEqual([{ slug: 'rate-limiting', taskIds: [7] }]);
			// Two-factor sign-in's section has no task and none above it does.
			// Nor does `setup`, and without a snapshot nothing says it was seen
			expect(delta.added.map((s) => s.slug)).toEqual([
				'two-factor-sign-in',
				'setup'
			]);
		});

		it('cannot tell a change from tasks made before hashes were recorded', () => {
			const unhashed = tasks.map((t) => ({
				...t,
				metadata: { source: t.metadata?.source }
			}));
			const delta = diffPrdSections(afterSections, PRD, unhashed, undefined);

			expect(delta.changed).toEqual([]);
		});
	});
});

describe('prdDeltaContent', () => {
	it('sends only the new sections, each with its heading', () => {
		const delta = diffPrdSections(afterSections, PRD, tasks, snapshot);

		expect(prdDeltaContent(delta, after)).toBe(
			'### Two-factor sign-in\n\nAsk for a one-time code from an authenticator app after the password.'
		);
	});
});

describe('Clarifications section (parse-prd --clarify)', () => {
	const clarify = (prd: string, answer: string) =>
		applyClarifications(prd, [{ question: 'Which database?', answer }]).content;

	it('is not new work when --clarify adds it to a PRD parsed before', () => {
		const clarified = clarify(before, 'SQLite');
		const delta = diffPrdSections(
			parsePrdSections(clarified),
			PRD,
			tasks,
			snapshot
		);

		expect(hasPrdChanges(delta)).toBe(false);
	});

	it('is not reported as changed when an answer changes', () => {
		const first = clarify(before, 'SQLite');
		const delta = diffPrdSections(
			parsePrdSections(clarify(first, 'PostgreSQL')),
			PRD,
			tasks,
			buildPrdSnapshot(parsePrdSections(first))
		);

		expect(hasPrdChanges(delta)).toBe(false);
	});

	it('goes to the AI with the new sections, so the answers apply to them', () => {
		const clarified = clarify(after, 'SQLite');
		const delta = diffPrdSections(
			parsePrdSections(clarified),
			PRD,
			tasks,
			snapshot
		);

		expect(delta.added.map((s) => s.slug)).toEqual(['two-factor-sign-in']);
		expect(prdDeltaContent(delta, clarified)).toBe(
			[
				'### Two-factor sign-in\n\nAsk for a one-time code from an authenticator app after the password.',
				'## Clarifications\n\n- **Q:** Which database?\n  **A:** SQLite'
			].join('\n\n')
		);
	});
});

describe('hashPrdSection', () => {
	it('ignores trailing spaces and extra blank lines, not words', () => {
		const text = '## Search\n\nFull-text search.';

		expect(hashPrdSection('## Search  \r\n\r\n\r\nFull-text search.\n')).toBe(
			hashPrdSection(text)
		);
		expect(hashPrdSection('## Search\n\nFuzzy search.')).not.toBe(
			hashPrdSection(text)
		);
	});
});

describe('prdSourceMetadata', () => {
	it('stores the source and the hash of that section', () => {
		const signUp = beforeSections.find((s) => s.slug === 'sign-up');

		expect(prdSourceMetadata('Sign-up', beforeSections, PRD)).toEqual({
			source: 'docs/prd.md#sign-up',
			sourceHash: hashPrdSection(signUp?.text ?? '')
		});
		expect(prdSourceMetadata('billing', beforeSections, PRD)).toBeUndefined();
	});
});

describe('PRD snapshots in tag metadata', () => {
	it('reads one PRD and replaces it, keeping the others', () => {
		const metadata = {
			created: 'x',
			prdSections: { 'a.md': { one: '1' }, 'b.md': { two: '2' } }
		};

		expect(getPrdSnapshot(metadata, 'a.md')).toEqual({ one: '1' });
		expect(getPrdSnapshot(metadata, 'c.md')).toBeUndefined();
		expect(withPrdSnapshot(metadata, 'a.md', { three: '3' })).toEqual({
			'a.md': { three: '3' },
			'b.md': { two: '2' }
		});
	});

	it('reads malformed snapshots as none', () => {
		expect(getPrdSnapshot({ prdSections: 'x' }, 'a.md')).toBeUndefined();
		expect(getPrdSnapshot({ prdSections: { 'a.md': [] } }, 'a.md')).toBe(
			undefined
		);
		expect(getPrdSnapshot(undefined, 'a.md')).toBeUndefined();
		expect(withPrdSnapshot({ prdSections: [] }, 'a.md', {})).toEqual({
			'a.md': {}
		});
	});
});
