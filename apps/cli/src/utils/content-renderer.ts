/**
 * @fileoverview Content rendering utilities for CLI
 * Handles HTML to Markdown conversion and terminal-friendly rendering
 */

import chalk from 'chalk';
import { MarkedExtension, marked } from 'marked';
import { markedTerminal } from 'marked-terminal';
import TurndownService from 'turndown';
import { theme } from '../ui/theme.js';

// Initialize turndown for HTML to Markdown conversion
const turndownService = new TurndownService({
	headingStyle: 'atx',
	codeBlockStyle: 'fenced',
	bulletListMarker: '-'
});

// Configure marked to use terminal renderer with subtle colors
marked.use(
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

// Also set marked options to preserve whitespace
marked.setOptions({
	breaks: true,
	gfm: true
});

/**
 * Convert HTML content to Markdown, then render for terminal
 * Handles tiptap HTML gracefully
 */
export function renderContent(content: string): string {
	if (!content) return '';

	// Clean up escape characters first - order matters: handle escaped backslashes first
	let cleaned = content
		.replace(/\\\\/g, '\\')
		.replace(/\\n/g, '\n')
		.replace(/\\t/g, '\t')
		.replace(/\\"/g, '"');

	// Check if content has HTML tags - if so, convert to markdown first
	if (/<[^>]+>/.test(cleaned)) {
		cleaned = turndownService.turndown(cleaned);
	}

	// Render markdown to terminal
	const result = marked(cleaned);
	return typeof result === 'string' ? result.trim() : cleaned;
}
