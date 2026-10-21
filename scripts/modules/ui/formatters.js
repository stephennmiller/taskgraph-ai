import chalk from 'chalk';
import { findTaskById } from '../utils.js';
import { theme } from './theme.js';

/**
 * Create a colored progress bar
 * @param {number} percent - The completion percentage
 * @param {number} length - The total length of the progress bar in characters
 * @param {Object} statusBreakdown - Optional breakdown of non-complete statuses (e.g., {pending: 20, 'in-progress': 10})
 * @returns {string} The formatted progress bar
 */
export function createProgressBar(
	percent,
	length = 30,
	statusBreakdown = null
) {
	// Adjust the percent to treat deferred and cancelled as complete
	const effectivePercent = statusBreakdown
		? Math.min(
				100,
				percent +
					(statusBreakdown.deferred || 0) +
					(statusBreakdown.cancelled || 0)
			)
		: percent;

	// Calculate how many characters to fill for "true completion"
	const trueCompletedFilled = Math.round((percent * length) / 100);

	// Calculate how many characters to fill for "effective completion" (including deferred/cancelled)
	const effectiveCompletedFilled = Math.round(
		(effectivePercent * length) / 100
	);

	// The "deferred/cancelled" section (difference between true and effective)
	const deferredCancelledFilled =
		effectiveCompletedFilled - trueCompletedFilled;

	// Set the empty section (remaining after effective completion)
	const empty = length - effectiveCompletedFilled;

	// Determine color based on percentage for the completed section
	let completedColor;
	if (percent < 25) {
		completedColor = chalk.red;
	} else if (percent < 50) {
		completedColor = chalk.yellow;
	} else if (percent < 75) {
		completedColor = chalk.yellow;
	} else if (percent < 100) {
		completedColor = chalk.green;
	} else {
		completedColor = chalk.green;
	}

	// Create colored sections
	const completedSection = completedColor('█'.repeat(trueCompletedFilled));

	// Gray section for deferred/cancelled items
	const deferredCancelledSection = theme.muted(
		'─'.repeat(deferredCancelledFilled)
	);

	// If we have a status breakdown, create a multi-colored remaining section
	let remainingSection = '';

	if (statusBreakdown && empty > 0) {
		// Each status gets its own character as well as its own color, so the
		// bar reads without color (matches the apps/cli dashboard)
		const statusSegments = {
			pending: (n) => chalk.yellow('░'.repeat(n)),
			'in-progress': (n) => theme.active('▓'.repeat(n)),
			blocked: (n) => chalk.red('!'.repeat(n)),
			review: (n) => chalk.magenta('▒'.repeat(n))
			// Deferred and cancelled are treated as part of the completed section
		};

		// Calculate proportions for each status
		const totalRemaining = Object.entries(statusBreakdown)
			.filter(
				([status]) =>
					!['deferred', 'cancelled', 'done', 'completed'].includes(status)
			)
			.reduce((sum, [_, val]) => sum + val, 0);

		// If no remaining tasks with tracked statuses, just use gray
		if (totalRemaining <= 0) {
			remainingSection = theme.muted('░'.repeat(empty));
		} else {
			// Track how many characters we've added
			let addedChars = 0;

			// Add each status section proportionally
			for (const [status, percentage] of Object.entries(statusBreakdown)) {
				// Skip statuses that are considered complete
				if (['deferred', 'cancelled', 'done', 'completed'].includes(status))
					continue;

				// Calculate how many characters this status should fill
				const statusChars = Math.round((percentage / totalRemaining) * empty);

				// Make sure we don't exceed the total length due to rounding
				const actualChars = Math.min(statusChars, empty - addedChars);

				// Add the section for this status
				const segment =
					statusSegments[status] || ((n) => theme.muted('░'.repeat(n)));
				remainingSection += segment(actualChars);

				addedChars += actualChars;
			}

			// If we have any remaining space due to rounding, fill with gray
			if (addedChars < empty) {
				remainingSection += theme.muted('░'.repeat(empty - addedChars));
			}
		}
	} else {
		// Default to gray for the empty section if no breakdown provided
		remainingSection = theme.muted('░'.repeat(empty));
	}

	// Effective percentage text color should reflect the highest category
	const percentTextColor =
		percent === 100
			? chalk.green // Green for 100%
			: effectivePercent === 100
				? theme.muted // Gray for 100% with deferred/cancelled
				: completedColor; // Otherwise match the completed color

	// Build the complete progress bar
	return `${completedSection}${deferredCancelledSection}${remainingSection} ${percentTextColor(`${effectivePercent.toFixed(0)}%`)}`;
}

/**
 * Get a colored status string based on the status value
 * @param {string} status - Task status (e.g., "done", "pending", "in-progress")
 * @param {boolean} forTable - Whether the status is being displayed in a table
 * @returns {string} Colored status string
 */
export function getStatusWithColor(status, forTable = false) {
	if (!status) {
		return theme.muted('? unknown');
	}

	const statusConfig = {
		done: { color: chalk.green, icon: '✓', tableIcon: '✓' },
		completed: { color: chalk.green, icon: '✓', tableIcon: '✓' },
		pending: { color: chalk.yellow, icon: '○', tableIcon: '⏱' },
		'in-progress': { color: theme.active, icon: '▶', tableIcon: '▶' },
		deferred: { color: theme.muted, icon: 'x', tableIcon: '⏱' },
		blocked: { color: chalk.red, icon: '!', tableIcon: '✗' },
		review: { color: chalk.magenta, icon: '?', tableIcon: '?' },
		cancelled: { color: theme.muted, icon: 'x', tableIcon: 'x' }
	};

	const config = statusConfig[status.toLowerCase()] || {
		color: chalk.red,
		icon: '✗',
		tableIcon: '✗'
	};

	// Use simpler icons for table display to prevent border issues
	if (forTable) {
		// Use ASCII characters instead of Unicode for completely stable display
		const simpleIcons = {
			done: '✓',
			completed: '✓',
			pending: '○',
			'in-progress': '►',
			deferred: 'x',
			blocked: '!', // Using plain x character for better compatibility
			review: '?' // Using circled dot symbol
		};
		const simpleIcon = simpleIcons[status.toLowerCase()] || 'x';
		return config.color(`${simpleIcon} ${status}`);
	}

	return config.color(`${config.icon} ${status}`);
}

/**
 * Format dependencies list with status indicators
 * @param {Array} dependencies - Array of dependency IDs
 * @param {Array} allTasks - Array of all tasks
 * @param {boolean} forConsole - Whether the output is for console display
 * @param {Object|null} complexityReport - Optional pre-loaded complexity report
 * @returns {string} Formatted dependencies string
 */
export function formatDependenciesWithStatus(
	dependencies,
	allTasks,
	forConsole = false,
	complexityReport = null // Add complexityReport parameter
) {
	if (
		!dependencies ||
		!Array.isArray(dependencies) ||
		dependencies.length === 0
	) {
		return forConsole ? theme.muted('None') : 'None';
	}

	const formattedDeps = dependencies.map((depId) => {
		const depIdStr = depId.toString(); // Ensure string format for display

		// Check if it's already a fully qualified subtask ID (like "22.1")
		if (depIdStr.includes('.')) {
			const parts = depIdStr.split('.');
			// Validate that it's a proper subtask format (parentId.subtaskId)
			if (parts.length !== 2 || !parts[0] || !parts[1]) {
				// Invalid format - treat as regular dependency
				const numericDepId =
					typeof depId === 'string' ? parseInt(depId, 10) : depId;
				const depTaskResult = findTaskById(
					allTasks,
					numericDepId,
					complexityReport
				);
				const depTask = depTaskResult.task;

				if (!depTask) {
					return forConsole
						? chalk.red(`${depIdStr} (Not found)`)
						: `${depIdStr} (Not found)`;
				}

				const status = depTask.status || 'pending';
				const isDone =
					status.toLowerCase() === 'done' ||
					status.toLowerCase() === 'completed';
				const isInProgress = status.toLowerCase() === 'in-progress';

				if (forConsole) {
					if (isDone) {
						return chalk.green.bold(depIdStr);
					} else if (isInProgress) {
						return chalk.yellow.bold(depIdStr);
					} else {
						return chalk.red.bold(depIdStr);
					}
				}
				return depIdStr;
			}

			const [parentId, subtaskId] = parts.map((id) => parseInt(id, 10));

			// Find the parent task
			const parentTask = allTasks.find((t) => t.id === parentId);
			if (!parentTask || !parentTask.subtasks) {
				return forConsole
					? chalk.red(`${depIdStr} (Not found)`)
					: `${depIdStr} (Not found)`;
			}

			// Find the subtask
			const subtask = parentTask.subtasks.find((st) => st.id === subtaskId);
			if (!subtask) {
				return forConsole
					? chalk.red(`${depIdStr} (Not found)`)
					: `${depIdStr} (Not found)`;
			}

			// Format with status
			const status = subtask.status || 'pending';
			const isDone =
				status.toLowerCase() === 'done' || status.toLowerCase() === 'completed';
			const isInProgress = status.toLowerCase() === 'in-progress';

			if (forConsole) {
				if (isDone) {
					return chalk.green.bold(depIdStr);
				} else if (isInProgress) {
					return theme.active.bold(depIdStr);
				} else {
					return chalk.red.bold(depIdStr);
				}
			}

			// For plain text output (task files), return just the ID without any formatting or emoji
			return depIdStr;
		}

		// If depId is a number less than 100, it's likely a reference to a subtask ID in the current task
		// This case is typically handled elsewhere (in task-specific code) before calling this function

		// For regular task dependencies (not subtasks)
		// Convert string depId to number if needed
		const numericDepId =
			typeof depId === 'string' ? parseInt(depId, 10) : depId;

		// Look up the task using the numeric ID
		const depTaskResult = findTaskById(
			allTasks,
			numericDepId,
			complexityReport
		);
		const depTask = depTaskResult.task; // Access the task object from the result

		if (!depTask) {
			return forConsole
				? chalk.red(`${depIdStr} (Not found)`)
				: `${depIdStr} (Not found)`;
		}

		// Format with status
		const status = depTask.status || 'pending';
		const isDone =
			status.toLowerCase() === 'done' || status.toLowerCase() === 'completed';
		const isInProgress = status.toLowerCase() === 'in-progress';

		if (forConsole) {
			if (isDone) {
				return chalk.green.bold(depIdStr);
			} else if (isInProgress) {
				return chalk.yellow.bold(depIdStr);
			} else {
				return chalk.red.bold(depIdStr);
			}
		}

		// For plain text output (task files), return just the ID without any formatting or emoji
		return depIdStr;
	});

	return formattedDeps.join(', ');
}

/**
 * Get colored complexity score
 * @param {number} score - Complexity score (1-10)
 * @returns {string} Colored complexity score
 */
export function getComplexityWithColor(score) {
	if (score <= 3) return chalk.green(`● ${score}`);
	if (score <= 6) return chalk.yellow(`● ${score}`);
	return chalk.red(`● ${score}`);
}
