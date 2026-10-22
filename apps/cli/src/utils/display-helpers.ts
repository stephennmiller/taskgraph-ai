/**
 * @fileoverview Display helper utilities for commands
 * Provides DRY utilities for displaying headers and other command output
 */

import { shouldShowTagIndicatorForProject } from '@tm/core';
import { displayHeader } from '../ui/index.js';

/**
 * Display the command header: the active tag, when it tells you something.
 * In a project with only the master tag, commands start with their result.
 */
export function displayCommandHeader(options: {
	tag?: string;
	projectRoot?: string;
}): void {
	const tag = options.tag || 'master';
	if (!shouldShowTagIndicatorForProject(tag, options.projectRoot)) return;
	displayHeader({ tag });
}
