/**
 * @fileoverview Status formatting utilities
 * Provides colored status displays with ASCII icons for tasks
 */

import type { TaskStatus } from '@tm/core';
import chalk from 'chalk';
import { theme } from '../theme.js';

/**
 * Module-level task status configuration to avoid recreating on every call
 */
const TASK_STATUS_CONFIG: Record<
	TaskStatus,
	{ color: (text: string) => string; icon: string; tableIcon: string }
> = {
	done: {
		color: chalk.green,
		icon: '✓',
		tableIcon: '✓'
	},
	pending: {
		color: chalk.yellow,
		icon: '○',
		tableIcon: '○'
	},
	'in-progress': {
		color: theme.active,
		icon: '▶',
		tableIcon: '▶'
	},
	deferred: {
		color: theme.muted,
		icon: '–',
		tableIcon: '–'
	},
	review: {
		color: chalk.magenta,
		icon: '?',
		tableIcon: '?'
	},
	cancelled: {
		color: theme.muted,
		icon: 'x',
		tableIcon: 'x'
	},
	blocked: {
		color: chalk.red,
		icon: '!',
		tableIcon: '!'
	}
};

/**
 * Colored status icon on its own, e.g. a green ✓ for done
 */
export function getStatusIcon(status: TaskStatus): string {
	const config = TASK_STATUS_CONFIG[status];
	return config ? config.color(config.icon) : chalk.red('X');
}

/**
 * Get colored status display with ASCII icons
 */
export function getStatusWithColor(
	status: TaskStatus,
	forTable: boolean = false
): string {
	const config = TASK_STATUS_CONFIG[status] || {
		color: chalk.red,
		icon: 'X',
		tableIcon: 'X'
	};

	const icon = forTable ? config.tableIcon : config.icon;
	return config.color(`${icon} ${status}`);
}
