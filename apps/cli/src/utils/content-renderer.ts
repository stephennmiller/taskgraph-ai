/**
 * @fileoverview Content rendering utilities for CLI
 * Handles HTML to Markdown conversion and terminal-friendly rendering
 */

import { createRequire } from 'node:module';
import chalk from 'chalk';
import type { Marked, MarkedExtension } from 'marked';
import type TurndownService from 'turndown';
import { terminalSafe } from '../ui/formatters/markdown-formatters.js';
import { theme } from '../ui/theme.js';

// turndown and marked are loaded on first use, not at startup, where they
// cost every command about 0.2 s (#248). require() keeps these synchronous.
const require = createRequire(import.meta.url);

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

let terminalMarked: Marked | undefined;

/** marked with the terminal renderer in subtle colors, created on first use */
function getTerminalMarked(): Marked {
	if (terminalMarked) return terminalMarked;
	const { Marked } = require('marked') as typeof import('marked');
	const { markedTerminal } =
		require('marked-terminal') as typeof import('marked-terminal');
	terminalMarked = new Marked({ breaks: true, gfm: true });
	terminalMarked.use(
		markedTerminal({
			// More subtle colors that match the overall design
			code: (code: string) => {
				// Custom code block handler to preserve formatting
				return code
					.split('\n')
					.map((line) => '    ' + chalk.cyan(line))
					.join('\n');
			},
			blockquote: theme.muted.italic,
			html: theme.muted, // Any remaining HTML will be grayed out (should be rare after turndown)
			heading: theme.text.bold, // White bold for headings
			hr: theme.muted,
			listitem: theme.text, // White for list items
			paragraph: theme.text, // White for paragraphs (default text color)
			strong: theme.text.bold, // White bold for strong text
			em: theme.text.italic, // White italic for emphasis
			codespan: chalk.cyan, // Cyan for inline code (no background)
			del: chalk.dim.strikethrough,
			link: theme.brand,
			href: theme.brand.underline,
			// Add more explicit code block handling
			showSectionPrefix: false,
			unescape: true,
			emoji: false,
			// Try to preserve whitespace in code blocks
			tab: 4,
			width: 120
		}) as MarkedExtension
	);
	return terminalMarked;
}

/**
 * Turn stored task text into markdown: undo escaped newlines, tabs and
 * quotes, and convert HTML (tiptap) to markdown.
 */
export function toMarkdown(content: string): string {
	if (!content) return '';

	// Clean up escape characters first - order matters: handle escaped backslashes first
	const cleaned = content
		.replace(/\\\\/g, '\\')
		.replace(/\\n/g, '\n')
		.replace(/\\t/g, '\t')
		.replace(/\\"/g, '"');

	// Check if content has HTML tags - if so, convert to markdown first
	return /<[^>]+>/.test(cleaned)
		? getTurndownService().turndown(cleaned)
		: cleaned;
}

/**
 * Convert HTML content to Markdown, then render for terminal
 * Handles tiptap HTML gracefully
 */
export function renderContent(content: string): string {
	if (!content) return '';

	// Task text is written by people, agents and notes: drop escape
	// sequences before it reaches the terminal
	const cleaned = toMarkdown(terminalSafe(content));

	// Render markdown to terminal
	const result = getTerminalMarked().parse(cleaned);
	return typeof result === 'string' ? result.trim() : cleaned;
}
