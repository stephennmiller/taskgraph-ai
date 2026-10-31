/**
 * @fileoverview Markdown and plain text wrapped to the terminal, shared by
 * the formatters that print text someone wrote: a research answer, a task's
 * description and details.
 *
 *   Hash passwords with bcrypt (cost 12). Store sessions in the sessions
 *   table with a 30-day sliding expiry.
 *   • Rate-limit sign-in attempts to 5 per minute per IP, and lock the
 *     account after 20 failed attempts
 */

import { createRequire } from 'node:module';
import { stripVTControlCharacters } from 'node:util';
import { stripTerminalControls } from '@tm/core';
import chalk from 'chalk';
import type { MarkedExtension } from 'marked';
import type TurndownService from 'turndown';
import { wrapLine } from '../layout/helpers.js';
import { theme } from '../theme.js';

// marked and marked-terminal (with its syntax highlighter), and turndown, are
// loaded on first use, not at startup, where they cost every command about
// 0.2 s (#248). require() keeps formatMarkdown and toMarkdown synchronous.
const require = createRequire(import.meta.url);

/**
 * Text from a task file, safe to print: escape sequences and other control
 * characters (which could move the cursor, clear the screen or retitle the
 * terminal) removed. Newlines and tabs stay. See stripTerminalControls in
 * @tm/core.
 */
export function terminalSafe(text: unknown): string {
	if (text === undefined || text === null) return '';
	return stripTerminalControls(String(text));
}

/** Cut `text` to `width` characters, ending with … when cut */
export const fit = (text: string, width: number) =>
	text.length > width
		? `${text.slice(0, Math.max(1, width - 1)).trimEnd()}…`
		: text;

/** Length on screen, not counting ANSI codes */
export const visibleLength = (text: string) =>
	stripVTControlCharacters(text).length;

/** Join facts with ` · `, starting a new line rather than splitting one */
export function joinFacts(
	facts: string[],
	width: number,
	separator = theme.muted(' · ')
): string[] {
	const lines: string[] = [];
	let line = '';
	for (const fact of facts) {
		const next = line ? `${line}${separator}${fact}` : fact;
		if (line && visibleLength(next) > width) {
			lines.push(line);
			line = fact;
		} else {
			line = next;
		}
	}
	if (line) lines.push(line);
	return lines;
}

/**
 * marked-terminal reflows paragraphs but not list items, so long items
 * relied on the terminal's own wrap and lost their indent. Wrap them with
 * a hanging indent, and draw bullets as •.
 */
function wrapListItems(text: string, width: number): string {
	return text
		.split('\n')
		.flatMap((line) => {
			const bulleted = line.replace(/^(\s*)\* /, '$1• ');
			const marker =
				stripVTControlCharacters(bulleted).match(/^(\s*)(•|\d+\.)\s+/);
			if (!marker || visibleLength(bulleted) <= width) return [bulleted];
			return wrapLine(bulleted, width, ' '.repeat(marker[0].length));
		})
		.join('\n');
}

/**
 * Text that markdown would print unchanged apart from wrapping: ASCII
 * letters, digits and plain punctuation, single spaces, no line that could
 * start a list, no URL (GFM turns `www.` and `https://` into styled links),
 * and no word longer than `columns` (marked-terminal splits those).
 * Deliberately narrow: anything else goes through marked.
 */
function isPlainProse(text: string, columns: number): boolean {
	return (
		/^[A-Za-z0-9 .,;:?!'"()/\n-]*$/.test(text) &&
		!/ {2}|^[ \d-]/m.test(text) &&
		!/:\/\/|www\./i.test(text) &&
		text.split(/[ \n]/).every((word) => word.length <= columns)
	);
}

/** Plain prose wrapped as marked-terminal wraps it, without loading it */
function formatPlainProse(
	text: string,
	columns: number,
	breaks: boolean
): string {
	return text
		.trim()
		.split(/\n{2,}/)
		.map((paragraph) => {
			const lines = breaks
				? paragraph.split('\n')
				: [paragraph.replace(/ ?\n/g, ' ')];
			return lines
				.flatMap((line) => wrapLine(line.trim(), columns, ''))
				.join('\n');
		})
		.join('\n\n');
}

let turndownService: TurndownService | undefined;

/** HTML to markdown converter, created on first use */
function getTurndownService(): TurndownService {
	turndownService ??= new (require('turndown') as typeof TurndownService)({
		headingStyle: 'atx',
		codeBlockStyle: 'fenced',
		bulletListMarker: '-'
	});
	return turndownService;
}

/** Undo escaped newlines, tabs and quotes in stored task text */
function unescapeStored(content: string): string {
	// Order matters: handle escaped backslashes first
	return content
		.replace(/\\\\/g, '\\')
		.replace(/\\n/g, '\n')
		.replace(/\\t/g, '\t')
		.replace(/\\"/g, '"');
}

/**
 * Turn stored task text into markdown: undo escaped newlines, tabs and
 * quotes, and convert HTML (tiptap) to markdown.
 */
export function toMarkdown(content: string): string {
	if (!content) return '';

	const cleaned = unescapeStored(content);

	// Check if content has HTML tags - if so, convert to markdown first.
	// turndown decodes entities, so `&#27;[2J` becomes an escape sequence here
	return /<[^>]+>/.test(cleaned)
		? terminalSafe(getTurndownService().turndown(cleaned))
		: cleaned;
}

/**
 * Stored task text as written, for a reader on the other end of a pipe:
 * markdown and HTML left as they are, so marked, marked-terminal and
 * turndown never load (#836). Long lines wrap to `columns` under their own
 * indent; lines in a fenced code block don't. HTML entities stay encoded,
 * so unlike turndown's output they can't turn into escape sequences.
 */
export function formatRawText(content: string, columns: number): string {
	let inFence = false;
	return terminalSafe(unescapeStored(content))
		.replace(/^\s*\n/, '')
		.trimEnd()
		.split('\n')
		.flatMap((line) => {
			const fence = /^\s*(```|~~~)/.test(line);
			if (fence) inFence = !inFence;
			if (fence || inFence) return [line];
			return wrapLine(line, columns, line.match(/^ */)?.[0] ?? '');
		})
		.join('\n');
}

/**
 * Render markdown for the terminal, with every line at most `columns` wide.
 *
 * Plain prose, the common case for a task description, is wrapped directly:
 * marked-terminal and its syntax highlighter take about 0.1 s to load (#248).
 *
 * @param options.breaks - Keep single newlines as line breaks, as task text
 *   written one item per line expects (markdown joins them by default)
 */
export function formatMarkdown(
	markdown: string,
	columns: number,
	options: { breaks?: boolean } = {}
): string {
	if (isPlainProse(markdown, columns)) {
		return formatPlainProse(markdown, columns, options.breaks ?? false);
	}
	return renderMarkdown(markdown, columns, options);
}

/**
 * Render markdown for the terminal through marked-terminal, with every line
 * at most `columns` wide. {@link formatMarkdown} skips this for plain prose.
 */
export function renderMarkdown(
	markdown: string,
	columns: number,
	options: { breaks?: boolean } = {}
): string {
	const { Marked } = require('marked') as typeof import('marked');
	const { markedTerminal } =
		require('marked-terminal') as typeof import('marked-terminal');
	const renderer = new Marked({ gfm: true, breaks: options.breaks ?? false });

	renderer.use(
		markedTerminal({
			code: (code: string) =>
				code
					.split('\n')
					.map((line) => chalk.cyan(line))
					.join('\n'),
			blockquote: theme.muted.italic,
			html: theme.muted,
			heading: theme.text.bold,
			firstHeading: theme.text.bold,
			hr: theme.muted,
			listitem: theme.text,
			paragraph: theme.text,
			strong: theme.text.bold,
			em: theme.text.italic,
			codespan: chalk.cyan,
			del: chalk.dim.strikethrough,
			link: theme.brand,
			href: theme.brand.underline,
			showSectionPrefix: false,
			unescape: true,
			emoji: false,
			tab: 2,
			width: columns,
			reflowText: true
		}) as MarkedExtension
	);

	// marked-terminal prints list items' inline markdown (**bold**, `code`)
	// literally; render their inline tokens instead.
	renderer.use({
		renderer: {
			text(token) {
				if (typeof token === 'object' && 'tokens' in token && token.tokens) {
					return this.parser.parseInline(token.tokens);
				}
				return typeof token === 'string' ? token : token.text;
			}
		}
	});

	const rendered = renderer.parse(markdown.trim(), { async: false }) as string;
	return wrapListItems(rendered.trimEnd(), columns);
}
