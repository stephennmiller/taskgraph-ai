/**
 * @fileoverview Display helper utilities for commands
 * Provides DRY utilities for displaying headers and other command output
 */

import { shouldShowTagIndicatorForProject } from '@tm/core';
import { displayHeader } from '../ui/index.js';

/**
 * Display the command header: the active tag, when it tells you something.
 * In a project with only the master tag, commands start with their result.
 * @returns Whether the line was printed, so a caller adds the blank line
 * that separates it from the result only when there is a line to separate
 */
export function displayCommandHeader(options: {
	tag?: string;
	projectRoot?: string;
}): boolean {
	const tag = options.tag || 'master';
	if (!shouldShowTagIndicatorForProject(tag, options.projectRoot)) return false;
	displayHeader({ tag });
	return true;
}
