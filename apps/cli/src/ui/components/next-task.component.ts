/**
 * @fileoverview Next task recommendation component
 * Displays detailed information about the recommended next task
 */

import type { Task } from '@tm/core';
import boxen from 'boxen';
import chalk from 'chalk';
import { renderContent } from '../../utils/content-renderer.js';
import { getBoxWidth, getComplexityWithColor } from '../../utils/ui.js';
import { BORDER_COLOR, theme } from '../theme.js';
import { getSuggestedActions } from './task-detail.component.js';

/**
 * Next task display options
 */
export interface NextTaskDisplayOptions {
	id: string | number;
	title: string;
	priority?: string;
	status?: string;
	dependencies?: (string | number)[];
	description?: string;
	complexity?: number;
}

/**
 * Display the recommended next task section
 */
export function displayRecommendedNextTask(
	task: NextTaskDisplayOptions | undefined,
	hasAnyTasks?: boolean
): void {
	if (!task) {
		// Only show warning box if there are literally NO tasks at all
		if (!hasAnyTasks) {
			console.log(
				boxen(chalk.yellow('No tasks found in this project.'), {
					padding: 1,
					borderStyle: 'round',
					borderColor: 'yellow',
					title: 'No tasks available',
					titleAlignment: 'center'
				})
			);
		} else {
			// Tasks exist but none are available to work on - show simple message
			console.log(
				chalk.yellow(
					'✓ All tasks are either completed, blocked by dependencies, or in progress.'
				)
			);
		}
		return;
	}

	// Build the content for the next task box
	const content = [];

	// Task header with ID and title
	content.push(
		`${theme.heading('Next task:')} ${chalk.yellow(`#${task.id}`)}${theme.heading(` - ${task.title}`)}`
	);
	content.push('');

	// Priority and Status line
	const statusLine = [];
	if (task.priority) {
		const priorityColor =
			task.priority === 'high'
				? chalk.red
				: task.priority === 'medium'
					? chalk.yellow
					: theme.muted;
		statusLine.push(`Priority: ${priorityColor.bold(task.priority)}`);
	}
	if (task.status) {
		const statusDisplay =
			task.status === 'pending'
				? chalk.yellow('○ pending')
				: task.status === 'in-progress'
					? theme.brand('▶ in-progress')
					: theme.muted(task.status);
		statusLine.push(`Status: ${statusDisplay}`);
	}
	content.push(statusLine.join('  '));

	// Dependencies
	const depsDisplay =
		!task.dependencies || task.dependencies.length === 0
			? theme.muted('None')
			: chalk.cyan(task.dependencies.join(', '));
	content.push(`Dependencies: ${depsDisplay}`);

	// Complexity with color and label
	if (typeof task.complexity === 'number') {
		content.push(`Complexity: ${getComplexityWithColor(task.complexity)}`);
	}

	// Description if available (render HTML properly)
	if (task.description) {
		content.push('');
		content.push(`Description: ${theme.text(renderContent(task.description))}`);
	}

	// Action commands
	content.push('');
	// Subtask info isn't available here, so skip the "expand" suggestion
	for (const action of getSuggestedActions(task.id, task.status, true).slice(
		0,
		2
	)) {
		content.push(
			`${chalk.cyan('Next step:')} ${chalk.yellow(action.command)} ${theme.muted(action.description)}`
		);
	}
	content.push(
		`${chalk.cyan('View details:')} ${chalk.yellow(`taskgraph show ${task.id}`)}`
	);

	// Display in a styled box with orange border
	console.log(
		boxen(content.join('\n'), {
			padding: 1,
			margin: { top: 1, bottom: 1 },
			borderStyle: 'round',
			borderColor: BORDER_COLOR,
			title: theme.heading('Next task'),
			titleAlignment: 'center',
			width: getBoxWidth(0.97),
			fullscreen: false
		})
	);
}

/**
 * Get task description from the full task object
 */
export function getTaskDescription(task: Task): string | undefined {
	// Try to get description from the task
	// This could be from task.description or the first line of task.details
	if ('description' in task && task.description) {
		return task.description as string;
	}

	if ('details' in task && task.details) {
		// Take first sentence or line from details
		const details = task.details as string;
		const firstLine = details.split('\n')[0];
		const firstSentence = firstLine.split('.')[0];
		return firstSentence;
	}

	return undefined;
}
