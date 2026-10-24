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
