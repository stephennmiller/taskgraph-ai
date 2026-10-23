import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	formatPrdSectionList,
	formatPrdSource,
	getPrdSource,
	parsePrdSections,
	parsePrdSource,
	prdPathForSource,
	prdSourceFor,
	resolvePrdSection,
	slugifyHeading
} from './prd-sections.js';

const FIXTURES = path.join(__dirname, '../../../tests/fixtures/prd');
const prd = fs.readFileSync(path.join(FIXTURES, 'bookmarks.md'), 'utf8');

describe('slugifyHeading', () => {
	it.each([
		['Authentication', 'authentication'],
		['Search & Tags', 'search--tags'],
		['Sign-up', 'sign-up'],
		['API v2.0 (beta)', 'api-v20-beta'],
		['`parse-prd` command', 'parse-prd-command'],
		['See [the docs](https://example.com)', 'see-the-docs'],
		['**Bold** snake_case', 'bold-snake_case'],
		['Café menü', 'café-menü'],
		['  Trailing spaces  ', 'trailing-spaces']
	])('%s → %s', (heading, slug) => {
		expect(slugifyHeading(heading)).toBe(slug);
	});
});

describe('parsePrdSections', () => {
	it('finds every heading in order, skipping front matter and code fences', () => {
		const slugs = parsePrdSections(prd).map((s) => s.slug);

		expect(slugs).toEqual([
			'bookmarks',
			'overview',
			'authentication',
			'sign-up',
			'password-reset',
			'bookmarks-api',
			'search--tags',
			'rate-limiting',
			'setup',
			'setup-1'
		]);
	});

	it('records level, line and the enclosing section', () => {
		const sections = parsePrdSections(prd);
		const signUp = sections.find((s) => s.slug === 'sign-up');
		const rate = sections.find((s) => s.slug === 'rate-limiting');

		expect(signUp).toMatchObject({
			title: 'Sign-up',
			level: 3,
			parentSlug: 'authentication'
		});
		expect(prd.split('\n')[(signUp?.line ?? 0) - 1]).toBe('### Sign-up');
		// A setext `---` underline is a level 2 heading
		expect(rate).toMatchObject({ level: 2, parentSlug: 'bookmarks' });
	});

	it("keeps a section's own text, not its subsections", () => {
		const auth = parsePrdSections(prd).find((s) => s.slug === 'authentication');

		expect(auth?.text).toBe(
			'## Authentication\n\nEmail and password sign-in with sessions.'
		);
	});

	it('numbers repeated headings without taking a slug another heading has', () => {
		const sections = parsePrdSections(
			'# Setup\n\n## Setup\n\n## Setup 1\n\n## Setup'
		);

		expect(sections.map((s) => s.slug)).toEqual([
			'setup',
			'setup-1',
			'setup-1-1',
			'setup-2'
		]);
	});

	it('handles closing hashes, CRLF line endings and no headings', () => {
		expect(
			parsePrdSections('## Goals ##\r\ntext\r\n').map((s) => s.slug)
		).toEqual(['goals']);
		expect(parsePrdSections('Just a paragraph.\n\n- a list')).toEqual([]);
	});

	it('does not read a list item or a rule after a blank line as a heading', () => {
		const sections = parsePrdSections(
			'# Title\n\n- item\n---\n\ntext\n\n---\n'
		);

		expect(sections.map((s) => s.slug)).toEqual(['title']);
	});
});

describe('PRD sources', () => {
	it('formats and parses `path#slug`', () => {
		const source = formatPrdSource('docs\\prd.md', 'authentication');

		expect(source).toBe('docs/prd.md#authentication');
		expect(parsePrdSource(source)).toEqual({
			path: 'docs/prd.md',
			slug: 'authentication'
		});
		expect(parsePrdSource('no-anchor.md')).toBeNull();
		expect(parsePrdSource('prd.md#')).toBeNull();
		expect(parsePrdSource(undefined)).toBeNull();
	});

	it('reads a task source only when it is a non-empty string', () => {
		expect(getPrdSource({ metadata: { source: 'prd.md#a' } })).toBe('prd.md#a');
		expect(getPrdSource({ metadata: { source: 3 } })).toBeUndefined();
		expect(getPrdSource({})).toBeUndefined();
	});
});

describe('resolvePrdSection', () => {
	const sections = parsePrdSections(prd);

	it.each([
		'password-reset',
		'#password-reset',
		'prd.md#password-reset',
		'Password reset',
		'Password-Reset'
	])('matches %s', (answer) => {
		expect(resolvePrdSection(answer, sections)?.slug).toBe('password-reset');
	});

	it('drops answers that name no section', () => {
		expect(resolvePrdSection('billing', sections)).toBeUndefined();
		expect(resolvePrdSection('', sections)).toBeUndefined();
		expect(resolvePrdSection(null, sections)).toBeUndefined();
	});
});

describe('formatPrdSectionList', () => {
	it('lists slugs with their headings, indented by level', () => {
		const list = formatPrdSectionList(
			parsePrdSections('## Auth\n\n### Sign-up\n\n## Search')
		);

		expect(list).toBe(
			'- auth (Auth)\n  - sign-up (Sign-up)\n- search (Search)'
		);
	});
});

describe('prdSourceFor and prdPathForSource', () => {
	const sections = parsePrdSections(prd);

	it('stores a known section as path#slug and drops an unknown one', () => {
		expect(prdSourceFor('Sign-up', sections, 'docs/prd.md')).toBe(
			'docs/prd.md#sign-up'
		);
		expect(prdSourceFor('billing', sections, 'docs/prd.md')).toBeUndefined();
	});

	it('names the PRD relative to the project root', () => {
		const root = path.resolve('/project');

		expect(prdPathForSource(root, path.join(root, 'docs', 'prd.md'))).toBe(
			'docs/prd.md'
		);
		// As typed, relative to the working directory
		expect(prdPathForSource(process.cwd(), 'docs/prd.md')).toBe('docs/prd.md');
		expect(prdPathForSource(root, path.resolve('/elsewhere/prd.md'))).toBe(
			path.resolve('/elsewhere/prd.md').replace(/\\/g, '/')
		);
	});
});
