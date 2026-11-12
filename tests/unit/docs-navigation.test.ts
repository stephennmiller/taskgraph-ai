/**
 * The docs site's navigation, redirects and links (#1150). A page that is
 * moved or removed must leave no navigation entry or link behind, and its
 * old URL must redirect to a page that exists.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '../..');
const docsDir = join(root, 'apps/docs');
const config = JSON.parse(readFileSync(join(docsDir, 'docs.json'), 'utf8'));
const SITE = 'https://taskgraph-ai.com';

const pageFiles = readdirSync(docsDir, { recursive: true, encoding: 'utf8' })
	.filter((file) => /\.mdx?$/.test(file) && !file.includes('node_modules'))
	.map((file) => file.replaceAll('\\', '/'));
/** The URL paths the site serves: `/tutorial` for tutorial.mdx */
const pages = new Set(
	pageFiles.map((file) => `/${file.replace(/\.mdx?$/, '')}`)
);

type NavEntry = string | { pages: NavEntry[] };
const navPages = (entries: NavEntry[]): string[] =>
	entries.flatMap((entry) =>
		typeof entry === 'string' ? [entry] : navPages(entry.pages)
	);
const groups: Array<{ group: string; pages: NavEntry[] }> =
	config.navigation.tabs.flatMap((tab: { groups: unknown[] }) => tab.groups);
const redirects: Array<{ source: string; destination: string }> =
	config.redirects;

/** Whether a site path (anchor and trailing slash aside) is a page or an asset */
const served = (url: string) => {
	const path = url.replace(/#.*$/, '').replace(/\/$/, '');
	return path === '' || pages.has(path) || existsSync(join(docsDir, path));
};

/** The site paths `text` links to, as Markdown links, hrefs or full site URLs */
const siteLinks = (text: string) =>
	[
		...text.matchAll(new RegExp(`(?:\\]\\(|href="|${SITE})(/[^\\s)"'>]*)`, 'g'))
	].map((match) => match[1]);

describe('docs navigation', () => {
	it('lists only pages that exist', () => {
		const listed = navPages(groups);

		expect(listed.length).toBeGreaterThan(30);
		expect(listed.filter((page) => !pages.has(`/${page}`))).toEqual([]);
	});

	it('puts the upgrade guides below Getting Started, not in Welcome', () => {
		const names = groups.map((group) => group.group);
		const upgrading = groups.find((group) =>
			navPages(group.pages).includes('upgrading')
		);

		expect(navPages(upgrading?.pages ?? [])).toContain(
			'migrating-from-taskmaster'
		);
		expect(names.indexOf(upgrading?.group ?? '')).toBeGreaterThan(
			names.indexOf('Getting Started')
		);
	});

	it('has Quick Start as one page', () => {
		expect(
			navPages(groups).filter((page) => page.includes('quick-start'))
		).toEqual(['getting-started/quick-start']);
	});
});

describe('docs redirects', () => {
	it('go from a URL with no page to a page that exists', () => {
		expect(redirects.filter(({ source }) => pages.has(source))).toEqual([]);
		expect(redirects.filter(({ destination }) => !served(destination))).toEqual(
			[]
		);
	});

	it.each([
		'quick-start',
		'requirements',
		'installation',
		'configuration-quick',
		'prd-quick',
		'tasks-quick',
		'execute-quick'
	])('cover the old Quick Start page %s', (page) => {
		expect(redirects.map(({ source }) => source)).toContain(
			`/getting-started/quick-start/${page}`
		);
	});
});

describe('links to docs pages', () => {
	it.each(pageFiles)('apps/docs/%s links only to pages that exist', (file) => {
		const links = siteLinks(readFileSync(join(docsDir, file), 'utf8'));

		expect(links.filter((link) => !served(link))).toEqual([]);
	});

	it.each(['README.md', 'llms-install.md', 'CLAUDE_CODE_PLUGIN.md'])(
		'%s links only to pages that exist',
		(file) => {
			const links = siteLinks(readFileSync(join(root, file), 'utf8'));

			expect(links.filter((link) => !served(link))).toEqual([]);
		}
	);

	it('finds the links (guards the extraction)', () => {
		expect(
			siteLinks(readFileSync(join(docsDir, 'tutorial.mdx'), 'utf8')).length
		).toBeGreaterThan(3);
		expect(
			siteLinks(readFileSync(join(root, 'README.md'), 'utf8')).length
		).toBeGreaterThan(5);
	});
});
