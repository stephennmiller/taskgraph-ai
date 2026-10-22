/**
 * @fileoverview TaskGraph header component
 * The one line above a command's output that says which tag it's working in
 */

import { formatTagIndicator } from '../formatters/tag-formatters.js';

/**
 * Header configuration options
 */
export interface HeaderOptions {
	title?: string;
	tag?: string;
	/** @deprecated No longer shown; the path was noise on every command */
	filePath?: string;
}

/**
 * Display the active tag, styled like the legacy commands' tag line so every
 * command opens the same way: `[tag] feature-auth`
 */
export function displayHeader(options: HeaderOptions = {}): void {
	const { tag } = options;

	if (tag) {
		console.log(formatTagIndicator(tag));
	}
}
