import { stripVTControlCharacters } from 'node:util';
import { describe, expect, it } from 'vitest';
import {
	formatMarkdown,
	formatRawText,
	renderMarkdown
} from './markdown-formatters.js';

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

	// Generated text near the edges of the plain-prose check: whichever path
	// it takes, the output must match marked's
	it('matches marked on generated text', () => {
		const words = [
			'The',
			'word',
			'www',
			'www.x.io',
			'https://a.b/c',
			'x.com',
			'e.g.',
			'(note)',
			'"q"',
			"it's",
			'a/b',
			'1',
			'2.',
			'10)',
			'-',
			'---',
			'-x',
			'x-y',
			':',
			';',
			'?',
			'!',
			'...',
			'O(n)',
			'3:1',
			'http:',
			'://',
			'Www.a.b',
			'v1.2.3'
		];
		const separators = [' ', ' ', ' ', '\n', '\n\n', ' \n', '\n\n\n'];
		let seed = 248;
		const pick = <T>(items: T[]) => {
			seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
			return items[(seed >>> 16) % items.length];
		};
		const mismatches: string[] = [];
		for (let i = 0; i < 1500; i++) {
			const count = pick([1, 2, 3, 5, 8, 12]);
			let text = pick(words);
			for (let j = 1; j < count; j++) text += pick(separators) + pick(words);
			const columns = pick([8, 20, 40, 80]);
			const breaks = pick([true, false]);
			if (
				formatMarkdown(text, columns, { breaks }) !==
				renderMarkdown(text, columns, { breaks })
			) {
				mismatches.push(JSON.stringify({ text, columns, breaks }));
			}
		}
		expect(mismatches).toEqual([]);
	});

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

describe('formatRawText', () => {
	it('keeps markdown as written and wraps long lines under their own indent', () => {
		const text =
			'\n\nRun `npm test`:\n- **first** step\n  - a nested item long enough to wrap\n';

		expect(formatRawText(text, 24)).toBe(
			'Run `npm test`:\n- **first** step\n  - a nested item long\n  enough to wrap'
		);
	});

	it('leaves lines in a fenced code block unwrapped', () => {
		const text =
			'```ts\nconst answer = compute(first, second, third);\n```\nafter the fence, wrapped';

		expect(formatRawText(text, 20).split('\n')).toEqual([
			'```ts',
			'const answer = compute(first, second, third);',
			'```',
			'after the fence,',
			'wrapped'
		]);
	});

	it('undoes escaped newlines and keeps HTML and its entities as written', () => {
		expect(formatRawText('<p>Clear &#27;[2J</p>\\nnext', 80)).toBe(
			'<p>Clear &#27;[2J</p>\nnext'
		);
	});

	it('removes escape sequences and control characters', () => {
		expect(formatRawText('Clear \u001b[2Jscreen\u0007', 80)).toBe(
			'Clear screen'
		);
	});
});
