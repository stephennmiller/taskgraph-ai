/**
 * @fileoverview Option checks for `list`, run before tm-core loads
 */

import { OUTPUT_FORMATS, type OutputFormat, parseStatusFilter } from '@tm/core';
import chalk from 'chalk';
import { theme } from '../ui/theme.js';
import { printError } from '../utils/error-handler.js';
import type { ListCommandOptions } from './list.types.js';

/** Check `list` options, printing what's wrong; false when one is invalid */
export function validateListOptions(options: ListCommandOptions): boolean {
	// Validate format
	if (
		options.format &&
		!OUTPUT_FORMATS.includes(options.format as OutputFormat)
	) {
		console.error(chalk.red(`Invalid format: ${options.format}`));
		console.error(theme.muted(`Valid formats: ${OUTPUT_FORMATS.join(', ')}`));
		return false;
	}

	// Validate status
	try {
		parseStatusFilter(options.status);
	} catch (error) {
		// "isn't a status. Use one of: …" is one sentence; the printer
		// wants the problem and the fix on their own lines (#928)
		const raw = (error as Error).message;
		const marker = ' Use one of: ';
		const at = raw.indexOf(marker);
		if (at === -1) printError(raw);
		else printError(raw.slice(0, at), raw.slice(at + 1));
		return false;
	}

	// Validate --all-tags cannot be used with --watch
	if (options.allTags && options.watch) {
		console.error(chalk.red('--all-tags cannot be used with --watch mode'));
		console.error(
			theme.muted(
				'Use --all-tags without --watch, or --watch without --all-tags'
			)
		);
		return false;
	}

	return true;
}
