import chalk from 'chalk';

import {
	addComplexityToTask,
	log,
	readComplexityReport,
	truncate
} from '../utils.js';
import findNextTask from './find-next-task.js';
import { loadListTasks } from './load-list-tasks.js';

import { getStatusWithColor, theme } from '../ui.js';

/**
 * List all tasks
 * @param {string} tasksPath - Path to the tasks.json file
 * @param {string} statusFilter - Filter by status (single status or comma-separated list, e.g., 'pending' or 'blocked,deferred')
 * @param {string} reportPath - Path to the complexity report
 * @param {boolean} withSubtasks - Whether to show subtasks
 * @param {string} outputFormat - 'json', 'markdown-readme' or 'compact'; any
 *   other value returns the JSON data (the CLI's `list` renders text itself)
 * @param {Object} context - Context object (required)
 * @param {string} context.projectRoot - Project root path
 * @param {string} context.tag - Tag for the task
 * @returns {Object} - Task list result for json format
 */
async function listTasks(
	tasksPath,
	statusFilter,
	reportPath = null,
	withSubtasks = false,
	outputFormat = 'text',
	context = {}
) {
	const { projectRoot, tag } = context;
	try {
		// BRIDGE: tm-core for unified task access, readJSON as the fallback
		const { data, archivedIds } = await loadListTasks(tasksPath, {
			projectRoot,
			tag
		});

		if (!data || !data.tasks) {
			throw new Error(`No valid tasks found in ${tasksPath}`);
		}

		// Add complexity scores to tasks if report exists
		// `reportPath` is already tag-aware (resolved at the CLI boundary).
		const complexityReport = readComplexityReport(reportPath);
		// Apply complexity scores to tasks
		if (complexityReport && complexityReport.complexityAnalysis) {
			data.tasks.forEach((task) => addComplexityToTask(task, complexityReport));
		}

		// Filter tasks by status if specified - now supports comma-separated statuses
		let filteredTasks;
		if (statusFilter && statusFilter.toLowerCase() !== 'all') {
			// Handle comma-separated statuses
			const allowedStatuses = statusFilter
				.split(',')
				.map((s) => s.trim().toLowerCase())
				.filter((s) => s.length > 0); // Remove empty strings

			filteredTasks = data.tasks.filter(
				(task) =>
					task.status && allowedStatuses.includes(task.status.toLowerCase())
			);
		} else {
			// Default to all tasks if no filter or filter is 'all'
			filteredTasks = data.tasks;
		}

		// Calculate completion statistics
		const totalTasks = data.tasks.length;
		const completedTasks = data.tasks.filter(
			(task) => task.status === 'done' || task.status === 'completed'
		).length;
		const completionPercentage =
			totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0;

		// Count statuses for tasks
		const doneCount = completedTasks;
		const inProgressCount = data.tasks.filter(
			(task) => task.status === 'in-progress'
		).length;
		const pendingCount = data.tasks.filter(
			(task) => task.status === 'pending'
		).length;
		const blockedCount = data.tasks.filter(
			(task) => task.status === 'blocked'
		).length;
		const deferredCount = data.tasks.filter(
			(task) => task.status === 'deferred'
		).length;
		const cancelledCount = data.tasks.filter(
			(task) => task.status === 'cancelled'
		).length;
		const reviewCount = data.tasks.filter(
			(task) => task.status === 'review'
		).length;

		// Count subtasks and their statuses
		let totalSubtasks = 0;
		let completedSubtasks = 0;
		let inProgressSubtasks = 0;
		let pendingSubtasks = 0;
		let blockedSubtasks = 0;
		let deferredSubtasks = 0;
		let cancelledSubtasks = 0;
		let reviewSubtasks = 0;

		data.tasks.forEach((task) => {
			if (task.subtasks && task.subtasks.length > 0) {
				totalSubtasks += task.subtasks.length;
				completedSubtasks += task.subtasks.filter(
					(st) => st.status === 'done' || st.status === 'completed'
				).length;
				inProgressSubtasks += task.subtasks.filter(
					(st) => st.status === 'in-progress'
				).length;
				pendingSubtasks += task.subtasks.filter(
					(st) => st.status === 'pending'
				).length;
				blockedSubtasks += task.subtasks.filter(
					(st) => st.status === 'blocked'
				).length;
				deferredSubtasks += task.subtasks.filter(
					(st) => st.status === 'deferred'
				).length;
				cancelledSubtasks += task.subtasks.filter(
					(st) => st.status === 'cancelled'
				).length;
				reviewSubtasks += task.subtasks.filter(
					(st) => st.status === 'review'
				).length;
			}
		});

		const subtaskCompletionPercentage =
			totalSubtasks > 0 ? (completedSubtasks / totalSubtasks) * 100 : 0;

		// Calculate dependency statistics (moved up to be available for all output formats)
		const completedTaskIds = new Set(
			data.tasks
				.filter((t) => t.status === 'done' || t.status === 'completed')
				.map((t) => t.id)
		);

		const tasksWithNoDeps = data.tasks.filter(
			(t) =>
				t.status !== 'done' &&
				t.status !== 'completed' &&
				(!t.dependencies || t.dependencies.length === 0)
		).length;

		const tasksWithAllDepsSatisfied = data.tasks.filter(
			(t) =>
				t.status !== 'done' &&
				t.status !== 'completed' &&
				t.dependencies &&
				t.dependencies.length > 0 &&
				t.dependencies.every((depId) => completedTaskIds.has(depId))
		).length;

		const tasksWithUnsatisfiedDeps = data.tasks.filter(
			(t) =>
				t.status !== 'done' &&
				t.status !== 'completed' &&
				t.dependencies &&
				t.dependencies.length > 0 &&
				!t.dependencies.every((depId) => completedTaskIds.has(depId))
		).length;

		// Calculate total tasks ready to work on (no deps + satisfied deps)
		const tasksReadyToWork = tasksWithNoDeps + tasksWithAllDepsSatisfied;

		// Calculate most depended-on tasks
		const dependencyCount = {};
		data.tasks.forEach((task) => {
			if (task.dependencies && task.dependencies.length > 0) {
				task.dependencies.forEach((depId) => {
					dependencyCount[depId] = (dependencyCount[depId] || 0) + 1;
				});
			}
		});

		// Find the most depended-on task
		let mostDependedOnTaskId = null;
		let maxDependents = 0;

		for (const [taskId, count] of Object.entries(dependencyCount)) {
			if (count > maxDependents) {
				maxDependents = count;
				mostDependedOnTaskId = parseInt(taskId);
			}
		}

		// Get the most depended-on task
		const mostDependedOnTask =
			mostDependedOnTaskId !== null
				? data.tasks.find((t) => t.id === mostDependedOnTaskId)
				: null;

		// Calculate average dependencies per task
		const totalDependencies = data.tasks.reduce(
			(sum, task) => sum + (task.dependencies ? task.dependencies.length : 0),
			0
		);
		const avgDependenciesPerTask = totalDependencies / data.tasks.length;

		// Find next task to work on, passing the complexity report
		const nextItem = findNextTask(data.tasks, complexityReport, archivedIds);

		// Structured data: the JSON output, and what any other format but
		// markdown-readme and compact returns
		const listData = () => {
			// *** Modification: Remove 'details' field for JSON output ***
			const tasksWithoutDetails = filteredTasks.map((task) => {
				// <-- USES filteredTasks!
				// Omit 'details' from the parent task
				const { details, ...taskRest } = task;

				// If subtasks exist, omit 'details' from them too
				if (taskRest.subtasks && Array.isArray(taskRest.subtasks)) {
					taskRest.subtasks = taskRest.subtasks.map((subtask) => {
						const { details: subtaskDetails, ...subtaskRest } = subtask;
						return subtaskRest;
					});
				}
				return taskRest;
			});
			// *** End of Modification ***

			return {
				tasks: tasksWithoutDetails, // <--- THIS IS THE ARRAY BEING RETURNED
				filter: statusFilter || 'all', // Return the actual filter used
				stats: {
					total: totalTasks,
					completed: doneCount,
					inProgress: inProgressCount,
					pending: pendingCount,
					blocked: blockedCount,
					deferred: deferredCount,
					cancelled: cancelledCount,
					review: reviewCount,
					completionPercentage,
					subtasks: {
						total: totalSubtasks,
						completed: completedSubtasks,
						inProgress: inProgressSubtasks,
						pending: pendingSubtasks,
						blocked: blockedSubtasks,
						deferred: deferredSubtasks,
						cancelled: cancelledSubtasks,
						completionPercentage: subtaskCompletionPercentage
					}
				}
			};
		};

		if (outputFormat === 'json') {
			return listData();
		}

		// For markdown-readme output, return formatted markdown
		if (outputFormat === 'markdown-readme') {
			return generateMarkdownOutput(data, filteredTasks, {
				totalTasks,
				completedTasks,
				completionPercentage,
				doneCount,
				inProgressCount,
				pendingCount,
				blockedCount,
				deferredCount,
				cancelledCount,
				totalSubtasks,
				completedSubtasks,
				subtaskCompletionPercentage,
				inProgressSubtasks,
				pendingSubtasks,
				blockedSubtasks,
				deferredSubtasks,
				cancelledSubtasks,
				reviewSubtasks,
				tasksWithNoDeps,
				tasksReadyToWork,
				tasksWithUnsatisfiedDeps,
				mostDependedOnTask,
				mostDependedOnTaskId,
				maxDependents,
				avgDependenciesPerTask,
				complexityReport,
				withSubtasks,
				nextItem
			});
		}

		// For compact output, return minimal one-line format
		if (outputFormat === 'compact') {
			return renderCompactOutput(filteredTasks, withSubtasks);
		}

		// The CLI's `list` renders text itself (apps/cli list.command.ts); any
		// other format gets the same data as JSON
		return listData();
	} catch (error) {
		log('error', `Error listing tasks: ${error.message}`);

		if (outputFormat === 'json') {
			// Return structured error for JSON output
			throw {
				code: 'TASK_LIST_ERROR',
				message: error.message,
				details: error.stack
			};
		}

		console.error(chalk.red(`Error: ${error.message}`));
		process.exit(1);
	}
}

/**
 * Generate markdown-formatted output for README files
 * @param {Object} data - Full tasks data
 * @param {Array} filteredTasks - Filtered tasks array
 * @param {Object} stats - Statistics object
 * @returns {string} - Formatted markdown string
 */
function generateMarkdownOutput(data, filteredTasks, stats) {
	const {
		totalTasks,
		completedTasks,
		completionPercentage,
		doneCount,
		inProgressCount,
		pendingCount,
		blockedCount,
		deferredCount,
		cancelledCount,
		totalSubtasks,
		completedSubtasks,
		subtaskCompletionPercentage,
		inProgressSubtasks,
		pendingSubtasks,
		blockedSubtasks,
		deferredSubtasks,
		cancelledSubtasks,
		tasksWithNoDeps,
		tasksReadyToWork,
		tasksWithUnsatisfiedDeps,
		mostDependedOnTask,
		mostDependedOnTaskId,
		maxDependents,
		avgDependenciesPerTask,
		complexityReport,
		withSubtasks,
		nextItem
	} = stats;

	let markdown = '';

	// Create progress bars for markdown (using Unicode block characters)
	const createMarkdownProgressBar = (percentage, width = 20) => {
		const filled = Math.round((percentage / 100) * width);
		const empty = width - filled;
		return '█'.repeat(filled) + '░'.repeat(empty);
	};

	const taskProgressBar = createMarkdownProgressBar(completionPercentage, 20);
	const subtaskProgressBar = createMarkdownProgressBar(
		subtaskCompletionPercentage,
		20
	);

	// Dashboard section
	// markdown += '```\n';
	markdown += '| Project Dashboard |  |\n';
	markdown += '| :-                |:-|\n';
	markdown += `| Task Progress     | ${taskProgressBar} ${Math.round(completionPercentage)}% |\n`;
	markdown += `| Done | ${doneCount} |\n`;
	markdown += `| In Progress | ${inProgressCount} |\n`;
	markdown += `| Pending | ${pendingCount} |\n`;
	markdown += `| Deferred | ${deferredCount} |\n`;
	markdown += `| Cancelled | ${cancelledCount} |\n`;
	markdown += `|-|-|\n`;
	markdown += `| Subtask Progress | ${subtaskProgressBar} ${Math.round(subtaskCompletionPercentage)}% |\n`;
	markdown += `| Completed | ${completedSubtasks} |\n`;
	markdown += `| In Progress | ${inProgressSubtasks} |\n`;
	markdown += `| Pending | ${pendingSubtasks} |\n`;

	markdown += '\n\n';

	// Tasks table
	markdown +=
		'| ID | Title | Status | Priority | Dependencies | Complexity |\n';
	markdown +=
		'| :- | :-    | :-     | :-       | :-           | :-         |\n';

	// Helper function to format status with symbols
	const getStatusSymbol = (status) => {
		switch (status) {
			case 'done':
			case 'completed':
				return '✓&nbsp;done';
			case 'in-progress':
				return '►&nbsp;in-progress';
			case 'pending':
				return '○&nbsp;pending';
			case 'blocked':
				return '⭕&nbsp;blocked';
			case 'deferred':
				return 'x&nbsp;deferred';
			case 'cancelled':
				return 'x&nbsp;cancelled';
			case 'review':
				return '?&nbsp;review';
			default:
				return status || 'pending';
		}
	};

	// Helper function to format dependencies without color codes
	const formatDependenciesForMarkdown = (deps, allTasks) => {
		if (!deps || deps.length === 0) return 'None';
		return deps
			.map((depId) => {
				const depTask = allTasks.find((t) => t.id === depId);
				return depTask ? depId.toString() : depId.toString();
			})
			.join(', ');
	};

	// Process all tasks
	filteredTasks.forEach((task) => {
		const taskTitle = task.title; // No truncation for README
		const statusSymbol = getStatusSymbol(task.status);
		const priority = task.priority || 'medium';
		const deps = formatDependenciesForMarkdown(task.dependencies, data.tasks);
		const complexity = task.complexityScore
			? `● ${task.complexityScore}`
			: 'N/A';

		markdown += `| ${task.id} | ${taskTitle} | ${statusSymbol} | ${priority} | ${deps} | ${complexity} |\n`;

		// Add subtasks if requested
		if (withSubtasks && task.subtasks && task.subtasks.length > 0) {
			task.subtasks.forEach((subtask) => {
				const subtaskTitle = `${subtask.title}`; // No truncation
				const subtaskStatus = getStatusSymbol(subtask.status);
				const subtaskDeps = formatDependenciesForMarkdown(
					subtask.dependencies,
					data.tasks
				);
				const subtaskComplexity = subtask.complexityScore
					? subtask.complexityScore.toString()
					: 'N/A';

				markdown += `| ${task.id}.${subtask.id} | ${subtaskTitle} | ${subtaskStatus} | -            | ${subtaskDeps} | ${subtaskComplexity} |\n`;
			});
		}
	});

	return markdown;
}

/**
 * Format dependencies for compact output with truncation and coloring
 * @param {Array} dependencies - Array of dependency IDs
 * @returns {string} - Formatted dependency string with arrow prefix
 */
function formatCompactDependencies(dependencies) {
	if (!dependencies || dependencies.length === 0) {
		return '';
	}

	if (dependencies.length > 5) {
		const visible = dependencies.slice(0, 5).join(',');
		const remaining = dependencies.length - 5;
		return ` → ${chalk.cyan(visible)}${theme.muted('... (+' + remaining + ' more)')}`;
	} else {
		return ` → ${chalk.cyan(dependencies.join(','))}`;
	}
}

/**
 * Format a single task in compact one-line format
 * @param {Object} task - Task object
 * @param {number} maxTitleLength - Maximum title length before truncation
 * @returns {string} - Formatted task line
 */
function formatCompactTask(task, maxTitleLength = 50) {
	const status = task.status || 'pending';
	const priority = task.priority || 'medium';
	const title = truncate(task.title || 'Untitled', maxTitleLength);

	// Use colored status from existing function
	const coloredStatus = getStatusWithColor(status, true);

	// Color priority based on level
	const priorityColors = {
		high: chalk.red,
		medium: chalk.yellow,
		low: theme.muted
	};
	const priorityColor = priorityColors[priority] || chalk.reset;

	// Format dependencies using shared helper
	const depsText = formatCompactDependencies(task.dependencies);

	return `${chalk.cyan(task.id)} ${coloredStatus} ${chalk.reset(title)} ${priorityColor('(' + priority + ')')}${depsText}`;
}

/**
 * Format a subtask in compact format with indentation
 * @param {Object} subtask - Subtask object
 * @param {string|number} parentId - Parent task ID
 * @param {number} maxTitleLength - Maximum title length before truncation
 * @returns {string} - Formatted subtask line
 */
function formatCompactSubtask(subtask, parentId, maxTitleLength = 47) {
	const status = subtask.status || 'pending';
	const title = truncate(subtask.title || 'Untitled', maxTitleLength);

	// Use colored status from existing function
	const coloredStatus = getStatusWithColor(status, true);

	// Format dependencies using shared helper
	const depsText = formatCompactDependencies(subtask.dependencies);

	return `  ${chalk.cyan(parentId + '.' + subtask.id)} ${coloredStatus} ${chalk.dim(title)}${depsText}`;
}

/**
 * Render complete compact output
 * @param {Array} filteredTasks - Tasks to display
 * @param {boolean} withSubtasks - Whether to include subtasks
 * @returns {void} - Outputs directly to console
 */
function renderCompactOutput(filteredTasks, withSubtasks) {
	if (filteredTasks.length === 0) {
		console.log('No tasks found');
		return;
	}

	const output = [];

	filteredTasks.forEach((task) => {
		output.push(formatCompactTask(task));

		if (withSubtasks && task.subtasks && task.subtasks.length > 0) {
			task.subtasks.forEach((subtask) => {
				output.push(formatCompactSubtask(subtask, task.id));
			});
		}
	});

	console.log(output.join('\n'));
}

export default listTasks;
