/**
 * @fileoverview Display helper utilities for commands
 * Provides DRY utilities for displaying headers and other command output
 */

import { displayHeader } from '../ui/index.js';

/**
 * Display the command header: the active tag
 */
export function displayCommandHeader(options: { tag?: string }): void {
	displayHeader({ tag: options.tag || 'master' });
}
