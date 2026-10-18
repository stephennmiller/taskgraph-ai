/**
 * @fileoverview Display helper utilities for commands
 * Provides DRY utilities for displaying headers and other command output
 */

import path from 'node:path';
import { displayHeader } from '../ui/index.js';

/** Where tasks are stored, relative to the project root */
const TASKS_FILE_PATH = path.join('.taskgraph', 'tasks', 'tasks.json');

/**
 * Display the command header: the active tag and the tasks file it reads from
 */
export function displayCommandHeader(options: { tag?: string }): void {
	displayHeader({
		tag: options.tag || 'master',
		filePath: TASKS_FILE_PATH
	});
}
