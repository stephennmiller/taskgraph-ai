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

import { stripVTControlCharacters } from 'node:util';
import { stripTerminalControls } from '@tm/core';
import chalk from 'chalk';
import { Marked, type MarkedExtension } from 'marked';
import { markedTerminal } from 'marked-terminal';
import { wrapLine } from '../layout/helpers.js';
import { theme } from '../theme.js';

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
 * Render markdown for the terminal, with every line at most `columns` wide
 * (a single word longer than that, such as a URL, stays whole).
 *
 * @param options.breaks - Keep single newlines as line breaks, as task text
 *   written one item per line expects (markdown joins them by default)
 */
export function formatMarkdown(
	markdown: string,
	columns: number,
	options: { breaks?: boolean } = {}
): string {
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
