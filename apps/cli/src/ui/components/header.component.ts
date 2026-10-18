/**
 * @fileoverview TaskGraph header component
 * Displays the banner, version, project info, and file path
 */

import chalk from 'chalk';

/**
 * Header configuration options
 */
export interface HeaderOptions {
	title?: string;
	tag?: string;
	filePath?: string;
}

/**
 * Display the TaskGraph header with project info
 */
export function displayHeader(options: HeaderOptions = {}): void {
	const { filePath, tag } = options;

	if (tag) {
		console.log(`tag: ${chalk.cyan(tag)}`);

		if (filePath) {
			// Convert to absolute path if it's relative
			const absolutePath = filePath.startsWith('/')
				? filePath
				: `${process.cwd()}/${filePath}`;
			console.log(`Listing tasks from: ${chalk.dim(absolutePath)}`);
		}
	}
}
