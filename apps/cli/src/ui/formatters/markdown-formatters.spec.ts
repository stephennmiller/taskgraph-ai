import { stripVTControlCharacters } from 'node:util';
import { describe, expect, it } from 'vitest';
import { formatMarkdown, renderMarkdown } from './markdown-formatters.js';

describe('formatMarkdown', () => {
	// Plain prose skips marked-terminal (#248), so it must come out exactly
	// as marked-terminal would print it
	const prose = [
		'Fixture task 2 for the startup time check',
		'Set up the HTTP server and routing for the API. It listens on port 3000 and answers every error with a JSON body, so clients never parse HTML.',
		'First line\nSecond line, still the same paragraph\n\nA new paragraph',
		'Paragraphs\n\n\n\nfar apart',
		"Quotes: \"double\" and 'single', it's fine (really) / ok?",
		'Ends with a space ',
		'A line that ends with a space \nthen goes on',
		'Uses well-known hyphenated words; and e.g. abbreviations!'
	];

	it.each(
		prose.flatMap((text) =>
			[12, 40, 80].flatMap((columns) =>
				[true, false].map((breaks) => ({ text, columns, breaks }))
			)
		)
	)(
		'wraps plain prose as marked would: $columns columns, breaks $breaks, $text',
		({ text, columns, breaks }) => {
			expect(formatMarkdown(text, columns, { breaks })).toBe(
				renderMarkdown(text, columns, { breaks })
			);
		}
	);

	// GFM autolinks URLs and marked-terminal styles them, so text with one
	// must not take the plain-prose path
	it('spells out a www. link as marked-terminal does', () => {
		const output = formatMarkdown('See www.example.com for details', 80);
		expect(stripVTControlCharacters(output)).toBe(
			'See www.example.com (http://www.example.com) for details'
		);
	});

	it.each([
		'See WWW.example.com for details',
		'Docs at https://example.com/docs now',
		'Mirror: ftp://example.com/pub',
		'Trailing colon:\nhttp://x.io'
	])('renders the link in %j through marked', (text) => {
		expect(formatMarkdown(text, 80, { breaks: true })).toBe(
			renderMarkdown(text, 80, { breaks: true })
		);
	});

	it.each([
		['**bold** text', 'bold text'],
		['Run `taskgraph next`', 'Run\ntaskgraph\nnext'],
		['- one\n- two', '  • one\n  • two'],
		[
			'averyveryveryverylongword fits nowhere',
			'averyveryver\nyverylongwor\nd fits\nnowhere'
		]
	])('renders %j through marked', (markdown, expected) => {
		const output = stripVTControlCharacters(formatMarkdown(markdown, 12));
		expect(output).toBe(expected);
	});
});
