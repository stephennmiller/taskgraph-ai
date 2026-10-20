import chalk from 'chalk';
import { formatTaskId, log } from '../utils.js';

/**
 * Display enhanced error message for cross-tag dependency conflicts
 * @param {Array} conflicts - Array of cross-tag dependency conflicts
 * @param {string} sourceTag - Source tag name
 * @param {string} targetTag - Target tag name
 * @param {string} sourceIds - Source task IDs (comma-separated)
 */
export function displayCrossTagDependencyError(
	conflicts,
	sourceTag,
	targetTag,
	sourceIds
) {
	console.log(
		chalk.red(`\n✗ Cannot move tasks from "${sourceTag}" to "${targetTag}"`)
	);
	console.log(chalk.yellow(`\nCross-tag dependency conflicts detected:`));

	if (conflicts.length > 0) {
		conflicts.forEach((conflict) => {
			console.log(`  • ${conflict.message}`);
		});
	}

	console.log(chalk.cyan(`\nResolution options:`));
	console.log(
		`  1. Move with dependencies: taskgraph move --from=${sourceIds} --from-tag=${sourceTag} --to-tag=${targetTag} --with-dependencies`
	);
	console.log(
		`  2. Break dependencies: taskgraph move --from=${sourceIds} --from-tag=${sourceTag} --to-tag=${targetTag} --ignore-dependencies`
	);
	console.log(
		`  3. Validate and fix dependencies: taskgraph validate-dependencies && taskgraph fix-dependencies`
	);
	if (conflicts.length > 0) {
		console.log(
			`  4. Move dependencies first: taskgraph move --from=${conflicts.map((c) => c.dependencyId).join(',')} --from-tag=${conflicts[0].dependencyTag} --to-tag=${targetTag}`
		);
	}
}

/**
 * Helper function to format task ID for display, handling edge cases with explicit labels
 * Builds on the existing formatTaskId utility but adds user-friendly display for edge cases
 * @param {*} taskId - The task ID to format
 * @returns {string} Formatted task ID for display
 */
export function formatTaskIdForDisplay(taskId) {
	if (taskId === null) return 'null';
	if (taskId === undefined) return 'undefined';
	if (taskId === '') return '(empty)';

	// Use existing formatTaskId for normal cases, with fallback to 'unknown'
	return formatTaskId(taskId) || 'unknown';
}

/**
 * Display enhanced error message for subtask movement restriction
 * @param {string} taskId - The subtask ID that cannot be moved
 * @param {string} sourceTag - Source tag name
 * @param {string} targetTag - Target tag name
 */
export function displaySubtaskMoveError(taskId, sourceTag, targetTag) {
	// Handle null/undefined taskId but preserve the actual value for display
	const displayTaskId = formatTaskIdForDisplay(taskId);

	// Safe taskId for operations that need a valid string
	const safeTaskId = taskId || 'unknown';

	// Validate taskId format before splitting
	let parentId = safeTaskId;
	if (safeTaskId.includes('.')) {
		const parts = safeTaskId.split('.');
		// Check if it's a valid subtask format (parentId.subtaskId)
		if (parts.length === 2 && parts[0] && parts[1]) {
			parentId = parts[0];
		} else {
			// Invalid format - log warning and use the original taskId
			console.log(
				chalk.yellow(
					`\n⚠ Warning: Unexpected taskId format "${safeTaskId}". Using as-is for command suggestions.`
				)
			);
			parentId = safeTaskId;
		}
	}

	console.log(
		chalk.red(`\n✗ Cannot move subtask ${displayTaskId} directly between tags`)
	);
	console.log(chalk.yellow(`\nSubtask movement restriction:`));
	console.log(`  • Subtasks cannot be moved directly between tags`);
	console.log(`  • They must be promoted to full tasks first`);
	console.log(`  • Source tag: "${sourceTag}"`);
	console.log(`  • Target tag: "${targetTag}"`);

	console.log(chalk.cyan(`\nResolution options:`));
	console.log(
		`  1. Promote subtask to full task: taskgraph remove-subtask --id=${displayTaskId} --convert`
	);
	console.log(
		`  2. Then move the promoted task: taskgraph move --from=${parentId} --from-tag=${sourceTag} --to-tag=${targetTag}`
	);
	console.log(
		`  3. Or move the parent task with all subtasks: taskgraph move --from=${parentId} --from-tag=${sourceTag} --to-tag=${targetTag} --with-dependencies`
	);
}

/**
 * Display enhanced error message for invalid tag combinations
 * @param {string} sourceTag - Source tag name
 * @param {string} targetTag - Target tag name
 * @param {string} reason - Reason for the error
 */
export function displayInvalidTagCombinationError(
	sourceTag,
	targetTag,
	reason
) {
	console.log(chalk.red(`\n✗ Invalid tag combination`));
	console.log(chalk.yellow(`\nError details:`));
	console.log(`  • Source tag: "${sourceTag}"`);
	console.log(`  • Target tag: "${targetTag}"`);
	console.log(`  • Reason: ${reason}`);

	console.log(chalk.cyan(`\nResolution options:`));
	console.log(`  1. Use different tags for cross-tag moves`);
	console.log(
		`  2. Use within-tag move: taskgraph move --from=<id> --to=<id> --tag=${sourceTag}`
	);
	console.log(`  3. Check available tags: taskgraph tags`);
}

/**
 * Display helpful hints for dependency validation commands
 * @param {string} context - Context for the hints (e.g., 'before-move', 'after-error')
 */
export function displayDependencyValidationHints(context = 'general') {
	const hints = {
		'before-move': [
			'Tip: Run "taskgraph validate-dependencies" to check for dependency issues before moving tasks',
			'Tip: Use "taskgraph fix-dependencies" to automatically resolve common dependency problems',
			'Tip: Consider using --with-dependencies flag to move dependent tasks together'
		],
		'after-error': [
			'Quick fix: Run "taskgraph validate-dependencies" to identify specific issues',
			'Quick fix: Use "taskgraph fix-dependencies" to automatically resolve problems',
			'Quick fix: Check "taskgraph show <id>" to see task dependencies before moving'
		],
		general: [
			'Tip: Use "taskgraph validate-dependencies" to check for dependency issues',
			'Tip: Use "taskgraph fix-dependencies" to automatically resolve problems',
			'Tip: Use "taskgraph show <id>" to view task dependencies',
			'Tip: Use --with-dependencies flag to move dependent tasks together'
		]
	};

	const relevantHints = hints[context] || hints.general;

	console.log(chalk.cyan(`\nHelpful hints:`));
	// Convert to Set to ensure only unique hints are displayed
	const uniqueHints = new Set(relevantHints);
	uniqueHints.forEach((hint) => {
		console.log(`  ${hint}`);
	});
}
