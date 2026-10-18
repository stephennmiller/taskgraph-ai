/**
 * @fileoverview Dashboard components for TaskGraph CLI
 * Displays project statistics and dependency information
 */

import type { Task, TaskPriority, TaskStatus } from '@tm/core';
import boxen from 'boxen';
import chalk from 'chalk';
import { isTaskComplete } from '../../utils/task-status.js';
import { getComplexityWithColor } from '../../utils/ui.js';
import { BORDER_COLOR, theme } from '../theme.js';

/**
 * Statistics for task collection
 */
export interface TaskStatistics {
	total: number;
	done: number;
	inProgress: number;
	pending: number;
	blocked: number;
	deferred: number;
	cancelled: number;
	review?: number;
	completionPercentage: number;
	/** Count of all terminal complete tasks (done + completed + cancelled) */
	completedCount: number;
}

/**
 * Statistics for dependencies
 */
export interface DependencyStatistics {
	tasksWithNoDeps: number;
	tasksReadyToWork: number;
	tasksBlockedByDeps: number;
	mostDependedOnTaskId?: number;
	mostDependedOnCount?: number;
	avgDependenciesPerTask: number;
}

/**
 * Next task information
 */
export interface NextTaskInfo {
	id: string | number;
	title: string;
	priority?: TaskPriority;
	dependencies?: (string | number)[];
	complexity?: number | string;
}

/**
 * Status breakdown for progress bars
 */
export interface StatusBreakdown {
	done?: number;
	'in-progress'?: number;
	pending?: number;
	blocked?: number;
	deferred?: number;
	cancelled?: number;
	review?: number;
}

/**
 * Progress bar segment per status: a distinct character and color, so the
 * bar can be read without relying on color. The counts line shows the same
 * characters as a legend.
 */
const BAR_SEGMENTS = {
	done: chalk.green('█'),
	cancelled: theme.muted('─'),
	deferred: theme.muted('─'),
	inProgress: theme.active('▓'),
	review: chalk.magenta('▒'),
	pending: chalk.yellow('░'),
	blocked: chalk.red('!')
};

/**
 * Create a progress bar with color-coded status segments
 */
function createProgressBar(
	completionPercentage: number,
	width: number = 30,
	statusBreakdown?: StatusBreakdown
): string {
	// If no breakdown provided, use simple green bar
	if (!statusBreakdown) {
		const filled = Math.round((completionPercentage / 100) * width);
		const empty = width - filled;
		return BAR_SEGMENTS.done.repeat(filled) + theme.muted('░').repeat(empty);
	}

	// Build the bar from one segment per status. Each status has its own
	// character as well as its own color, so the bar reads without color.
	// Order matches the status display: Done, Cancelled, Deferred, In Progress, Review, Pending, Blocked
	let bar = '';
	let charsUsed = 0;

	// Note: completionPercentage includes cancelled, but we show them separately in the bar
	const segments: Array<[number | undefined, string]> = [
		[statusBreakdown.done, BAR_SEGMENTS.done],
		[statusBreakdown.cancelled, BAR_SEGMENTS.cancelled],
		[statusBreakdown.deferred, BAR_SEGMENTS.deferred],
		[statusBreakdown['in-progress'], BAR_SEGMENTS.inProgress],
		[statusBreakdown.review, BAR_SEGMENTS.review],
		[statusBreakdown.pending, BAR_SEGMENTS.pending],
		[statusBreakdown.blocked, BAR_SEGMENTS.blocked]
	];

	for (const [percentage, glyph] of segments) {
		if (!percentage || charsUsed >= width) continue;
		const chars = Math.min(
			Math.round((percentage / 100) * width),
			width - charsUsed
		);
		if (chars > 0) {
			bar += glyph.repeat(chars);
			charsUsed += chars;
		}
	}

	// Fill any rounding remainder as pending
	if (charsUsed < width) {
		bar += BAR_SEGMENTS.pending.repeat(width - charsUsed);
	}

	return bar;
}

/**
 * Calculate task statistics from a list of tasks
 */
export function calculateTaskStatistics(tasks: Task[]): TaskStatistics {
	const stats: TaskStatistics = {
		total: tasks.length,
		done: 0,
		inProgress: 0,
		pending: 0,
		blocked: 0,
		deferred: 0,
		cancelled: 0,
		review: 0,
		completionPercentage: 0,
		completedCount: 0
	};

	tasks.forEach((task) => {
		switch (task.status) {
			case 'done':
				stats.done++;
				break;
			case 'in-progress':
				stats.inProgress++;
				break;
			case 'pending':
				stats.pending++;
				break;
			case 'blocked':
				stats.blocked++;
				break;
			case 'deferred':
				stats.deferred++;
				break;
			case 'cancelled':
				stats.cancelled++;
				break;
			case 'review':
				stats.review = (stats.review || 0) + 1;
				break;
		}
	});

	// Count terminal complete tasks for percentage calculation and display
	stats.completedCount = tasks.filter((t) => isTaskComplete(t.status)).length;
	stats.completionPercentage =
		stats.total > 0
			? Math.round((stats.completedCount / stats.total) * 100)
			: 0;

	return stats;
}

/**
 * Calculate subtask statistics from tasks
 */
export function calculateSubtaskStatistics(tasks: Task[]): TaskStatistics {
	const stats: TaskStatistics = {
		total: 0,
		done: 0,
		inProgress: 0,
		pending: 0,
		blocked: 0,
		deferred: 0,
		cancelled: 0,
		review: 0,
		completionPercentage: 0,
		completedCount: 0
	};

	const allSubtasks: Array<{ status: string }> = [];
	tasks.forEach((task) => {
		if (task.subtasks && task.subtasks.length > 0) {
			task.subtasks.forEach((subtask) => {
				stats.total++;
				allSubtasks.push(subtask);
				switch (subtask.status) {
					case 'done':
						stats.done++;
						break;
					case 'in-progress':
						stats.inProgress++;
						break;
					case 'pending':
						stats.pending++;
						break;
					case 'blocked':
						stats.blocked++;
						break;
					case 'deferred':
						stats.deferred++;
						break;
					case 'cancelled':
						stats.cancelled++;
						break;
					case 'review':
						stats.review = (stats.review || 0) + 1;
						break;
				}
			});
		}
	});

	// Count terminal complete subtasks for percentage calculation and display
	stats.completedCount = allSubtasks.filter((st) =>
		isTaskComplete(st.status as TaskStatus)
	).length;
	stats.completionPercentage =
		stats.total > 0
			? Math.round((stats.completedCount / stats.total) * 100)
			: 0;

	return stats;
}

/**
 * Calculate dependency statistics
 */
export function calculateDependencyStatistics(
	tasks: Task[]
): DependencyStatistics {
	// Get all terminal complete task IDs - these satisfy dependencies
	const completedTaskIds = new Set(
		tasks.filter((t) => isTaskComplete(t.status)).map((t) => t.id)
	);

	const tasksWithNoDeps = tasks.filter(
		(t) =>
			!isTaskComplete(t.status) &&
			(!t.dependencies || t.dependencies.length === 0)
	).length;

	const tasksWithAllDepsSatisfied = tasks.filter(
		(t) =>
			!isTaskComplete(t.status) &&
			t.dependencies &&
			t.dependencies.length > 0 &&
			t.dependencies.every((depId) => completedTaskIds.has(depId))
	).length;

	const tasksBlockedByDeps = tasks.filter(
		(t) =>
			!isTaskComplete(t.status) &&
			t.dependencies &&
			t.dependencies.length > 0 &&
			!t.dependencies.every((depId) => completedTaskIds.has(depId))
	).length;

	// Calculate most depended-on task
	const dependencyCount: Record<string, number> = {};
	tasks.forEach((task) => {
		if (task.dependencies && task.dependencies.length > 0) {
			task.dependencies.forEach((depId) => {
				const key = String(depId);
				dependencyCount[key] = (dependencyCount[key] || 0) + 1;
			});
		}
	});

	let mostDependedOnTaskId: number | undefined;
	let mostDependedOnCount = 0;

	for (const [taskId, count] of Object.entries(dependencyCount)) {
		if (count > mostDependedOnCount) {
			mostDependedOnCount = count;
			mostDependedOnTaskId = parseInt(taskId);
		}
	}

	// Calculate average dependencies
	const totalDependencies = tasks.reduce(
		(sum, task) => sum + (task.dependencies ? task.dependencies.length : 0),
		0
	);
	const avgDependenciesPerTask =
		tasks.length > 0 ? totalDependencies / tasks.length : 0;

	return {
		tasksWithNoDeps,
		tasksReadyToWork: tasksWithNoDeps + tasksWithAllDepsSatisfied,
		tasksBlockedByDeps,
		mostDependedOnTaskId,
		mostDependedOnCount,
		avgDependenciesPerTask
	};
}

/**
 * Get priority counts
 */
export function getPriorityBreakdown(
	tasks: Task[]
): Record<TaskPriority, number> {
	const breakdown: Record<TaskPriority, number> = {
		critical: 0,
		high: 0,
		medium: 0,
		low: 0
	};

	tasks.forEach((task) => {
		const priority = task.priority || 'medium';
		breakdown[priority]++;
	});

	return breakdown;
}

/**
 * Calculate status breakdown as percentages
 */
function calculateStatusBreakdown(stats: TaskStatistics): StatusBreakdown {
	if (stats.total === 0) return {};

	return {
		done: (stats.done / stats.total) * 100,
		'in-progress': (stats.inProgress / stats.total) * 100,
		pending: (stats.pending / stats.total) * 100,
		blocked: (stats.blocked / stats.total) * 100,
		deferred: (stats.deferred / stats.total) * 100,
		cancelled: (stats.cancelled / stats.total) * 100,
		review: ((stats.review || 0) / stats.total) * 100
	};
}

/**
 * Format status counts in the correct order with colors
 * @param stats - The statistics object containing counts
 * @param isSubtask - Whether this is for subtasks (affects "Done" vs "Completed" label)
 */
export function formatStatusLine(
	stats: TaskStatistics,
	isSubtask: boolean = false,
	compact: boolean = false
): string {
	const parts: string[] = [];

	// Order: Done, Cancelled, Deferred, In Progress, Review, Pending, Blocked
	if (isSubtask) {
		parts.push(
			`${BAR_SEGMENTS.done} Completed: ${chalk.green(`${stats.completedCount}/${stats.total}`)}`
		);
	} else {
		parts.push(`${BAR_SEGMENTS.done} Done: ${chalk.green(stats.done)}`);
	}

	parts.push(
		`${BAR_SEGMENTS.cancelled} Cancelled: ${theme.muted(stats.cancelled)}`
	);
	parts.push(
		`${BAR_SEGMENTS.deferred} Deferred: ${theme.muted(stats.deferred)}`
	);

	// Narrow boxes get two statuses per line so nothing wraps mid-label
	const joinRow = (row: string[]) =>
		compact
			? row.slice(0, 2).join('  ') +
				(row.length > 2 ? '\n' + row.slice(2).join('  ') : '')
			: row.join('  ');

	const firstLine = joinRow(parts);
	parts.length = 0;

	parts.push(
		`${BAR_SEGMENTS.inProgress} In Progress: ${theme.active(stats.inProgress)}`
	);
	parts.push(
		`${BAR_SEGMENTS.review} Review: ${chalk.magenta(stats.review || 0)}`
	);
	parts.push(`${BAR_SEGMENTS.pending} Pending: ${chalk.yellow(stats.pending)}`);
	parts.push(`${BAR_SEGMENTS.blocked} Blocked: ${chalk.red(stats.blocked)}`);

	return firstLine + '\n' + joinRow(parts);
}

/**
 * Display the project dashboard box
 */
export function displayProjectDashboard(
	taskStats: TaskStatistics,
	subtaskStats: TaskStatistics,
	priorityBreakdown: Record<TaskPriority, number>,
	compact: boolean = false
): string {
	// Calculate status breakdowns using the helper function
	const taskStatusBreakdown = calculateStatusBreakdown(taskStats);
	const subtaskStatusBreakdown = calculateStatusBreakdown(subtaskStats);

	// Create progress bars with the breakdowns
	const barWidth = compact ? 16 : 30;
	const taskProgressBar = createProgressBar(
		taskStats.completionPercentage,
		barWidth,
		taskStatusBreakdown
	);
	const subtaskProgressBar = createProgressBar(
		subtaskStats.completionPercentage,
		barWidth,
		subtaskStatusBreakdown
	);

	const taskPercentage = `${taskStats.completionPercentage}% ${taskStats.completedCount}/${taskStats.total}`;
	const subtaskPercentage = `${subtaskStats.completionPercentage}% ${subtaskStats.completedCount}/${subtaskStats.total}`;

	const content =
		chalk.bold('Project Dashboard') +
		'\n' +
		`Tasks Progress: ${taskProgressBar} ${chalk.yellow(taskPercentage)}\n` +
		formatStatusLine(taskStats, false, compact) +
		'\n\n' +
		`Subtasks Progress: ${subtaskProgressBar} ${chalk.cyan(subtaskPercentage)}\n` +
		formatStatusLine(subtaskStats, true, compact) +
		'\n\n' +
		chalk.cyan.bold('Priority Breakdown:') +
		'\n' +
		`${chalk.red('•')} ${theme.text('High priority:')} ${priorityBreakdown.high}\n` +
		`${chalk.yellow('•')} ${theme.text('Medium priority:')} ${priorityBreakdown.medium}\n` +
		`${chalk.green('•')} ${theme.text('Low priority:')} ${priorityBreakdown.low}`;

	return content;
}

/**
 * Display the dependency dashboard box
 */
export function displayDependencyDashboard(
	depStats: DependencyStatistics,
	nextTask?: NextTaskInfo
): string {
	const content =
		chalk.bold('Dependency Status & Next Task') +
		'\n' +
		chalk.cyan.bold('Dependency Metrics:') +
		'\n' +
		`${chalk.green('•')} ${theme.text('Tasks with no dependencies:')} ${depStats.tasksWithNoDeps}\n` +
		`${chalk.green('•')} ${theme.text('Tasks ready to work on:')} ${depStats.tasksReadyToWork}\n` +
		`${chalk.yellow('•')} ${theme.text('Tasks blocked by dependencies:')} ${depStats.tasksBlockedByDeps}\n` +
		`${theme.accent('•')} ${theme.text('Most depended-on task:')} ${
			depStats.mostDependedOnTaskId
				? chalk.cyan(
						`#${depStats.mostDependedOnTaskId} (${depStats.mostDependedOnCount} dependents)`
					)
				: theme.muted('None')
		}\n` +
		`${theme.brand('•')} ${theme.text('Avg dependencies per task:')} ${depStats.avgDependenciesPerTask.toFixed(1)}\n\n` +
		chalk.cyan.bold('Next Task:') +
		'\n' +
		`ID: ${nextTask ? chalk.cyan(String(nextTask.id)) : theme.muted('N/A')} - ${
			nextTask ? chalk.bold(nextTask.title) : chalk.yellow('No task available')
		}\n` +
		`Priority: ${nextTask?.priority || theme.muted('N/A')}  Dependencies: ${
			nextTask?.dependencies?.length
				? chalk.cyan(nextTask.dependencies.join(', '))
				: theme.muted('None')
		}\n` +
		`Complexity: ${nextTask?.complexity !== undefined ? getComplexityWithColor(nextTask.complexity) : theme.muted('N/A')}`;

	return content;
}

/**
 * Display dashboard boxes side by side or stacked
 */
export function displayDashboards(
	taskStats: TaskStatistics,
	subtaskStats: TaskStatistics,
	priorityBreakdown: Record<TaskPriority, number>,
	depStats: DependencyStatistics,
	nextTask?: NextTaskInfo
): void {
	// Get terminal width
	const terminalWidth = process.stdout.columns || 80;
	// Each side-by-side box needs ~58 columns for its content to fit unwrapped
	const minDashboardWidth = 58;
	const minDependencyWidth = 58;
	const totalMinWidth = minDashboardWidth + minDependencyWidth + 4;
	const sideBySide = terminalWidth >= totalMinWidth;
	const halfWidth = Math.floor(terminalWidth / 2);
	const boxContentWidth = halfWidth - 4;

	// Text width inside a box (minus 2 border and 6 padding columns). The full
	// progress bar and status line need about 60 columns; use the compact form below that.
	const innerWidth = (sideBySide ? boxContentWidth : terminalWidth) - 8;
	const compact = innerWidth < 60;

	const projectDashboardContent = displayProjectDashboard(
		taskStats,
		subtaskStats,
		priorityBreakdown,
		compact
	);
	const dependencyDashboardContent = displayDependencyDashboard(
		depStats,
		nextTask
	);

	// If terminal is wide enough, show side by side
	if (sideBySide) {
		const dashboardBox = boxen(projectDashboardContent, {
			padding: 1,
			borderColor: BORDER_COLOR,
			borderStyle: 'round',
			width: boxContentWidth,
			dimBorder: false
		});

		const dependencyBox = boxen(dependencyDashboardContent, {
			padding: 1,
			borderColor: BORDER_COLOR,
			borderStyle: 'round',
			width: boxContentWidth,
			dimBorder: false
		});

		// Create side-by-side layout
		const dashboardLines = dashboardBox.split('\n');
		const dependencyLines = dependencyBox.split('\n');
		const maxHeight = Math.max(dashboardLines.length, dependencyLines.length);

		const combinedLines = [];
		for (let i = 0; i < maxHeight; i++) {
			const dashLine = i < dashboardLines.length ? dashboardLines[i] : '';
			const depLine = i < dependencyLines.length ? dependencyLines[i] : '';
			const paddedDashLine = dashLine.padEnd(halfWidth, ' ');
			combinedLines.push(paddedDashLine + depLine);
		}

		console.log(combinedLines.join('\n'));
	} else {
		// Show stacked vertically
		const dashboardBox = boxen(projectDashboardContent, {
			padding: 1,
			borderColor: BORDER_COLOR,
			borderStyle: 'round',
			margin: { top: 0, bottom: 1 }
		});

		const dependencyBox = boxen(dependencyDashboardContent, {
			padding: 1,
			borderColor: BORDER_COLOR,
			borderStyle: 'round',
			margin: { top: 0, bottom: 1 }
		});

		console.log(dashboardBox);
		console.log(dependencyBox);
	}
}
