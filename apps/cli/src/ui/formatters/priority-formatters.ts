/**
 * @fileoverview Priority formatting utilities
 * Provides colored priority displays for tasks
 */

import type { TaskPriority } from '@tm/core';
import chalk from 'chalk';
import { theme } from '../theme.js';

/**
 * Module-level priority color map to avoid recreating on every call
 */
const PRIORITY_COLORS: Record<TaskPriority, (text: string) => string> = {
	critical: chalk.red.bold,
	high: chalk.red,
	medium: chalk.yellow,
	low: theme.muted
};

/**
 * Get colored priority display
 */
export function getPriorityWithColor(priority: TaskPriority): string {
	const colorFn = PRIORITY_COLORS[priority] || theme.text;
	return colorFn(priority);
}
