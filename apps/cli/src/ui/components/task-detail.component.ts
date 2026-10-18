/**
 * @fileoverview Task detail component for show command
 * Displays detailed task information in a structured format
 */

import type {
	ExistingInfrastructure,
	RelevantFile,
	ScopeBoundaries,
	Subtask,
	Task,
	TaskCategory
} from '@tm/core';
import boxen from 'boxen';
import chalk from 'chalk';
import Table from 'cli-table3';
import { renderContent } from '../../utils/content-renderer.js';
import {
	getComplexityWithColor,
	getPriorityWithColor,
	getStatusWithColor
} from '../../utils/ui.js';
import { getContentWidth, planColumns } from '../layout/helpers.js';
import {
	type SuggestedAction,
	getSuggestedActions
} from '../suggested-actions.js';
import {
	BORDER_COLOR,
	MUTED_BOX_BORDER,
	TABLE_BORDER,
	theme
} from '../theme.js';

// ============================================================================
// Constants and Helper Functions
// ============================================================================

/**
 * Get icon for file action
 */
function getFileActionIcon(action: RelevantFile['action']): string {
	switch (action) {
		case 'create':
			return chalk.green('✚ CREATE');
		case 'modify':
			return chalk.yellow('✎ MODIFY');
		case 'reference':
			return theme.brand('◇ REFER ');
		default:
			return theme.muted('  FILE  ');
	}
}

/**
 * Get category display
 */
function getCategoryDisplay(category: TaskCategory): string {
	return category;
}

// ============================================================================
// Display Functions
// ============================================================================

/**
 * Display the task header with tag
 */
export function displayTaskHeader(
	taskId: string | number,
	title: string
): void {
	// Display task header box
	console.log(
		boxen(chalk.bold(`Task: #${taskId} - ${title}`), {
			padding: { top: 0, bottom: 0, left: 1, right: 1 },
			borderColor: BORDER_COLOR,
			borderStyle: 'round'
		})
	);
}

/**
 * Display task properties in a table format
 */
export function displayTaskProperties(
	task: Task | Subtask,
	originalTaskId?: string
): void {
	const terminalWidth = getContentWidth();
	// Create table for task properties - simple 2-column layout
	const table = new Table({
		head: [],
		style: {
			head: [],
			border: TABLE_BORDER
		},
		// Label column fits the longest label ("Dependencies:"); values take the rest
		colWidths: planColumns(terminalWidth, [
			{ key: 'label', width: 16 },
			{ key: 'value', width: 'flex' }
		]).widths,
		wordWrap: true
	});

	const deps =
		task.dependencies && task.dependencies.length > 0
			? task.dependencies.map((d) => String(d)).join(', ')
			: 'None';

	// Use originalTaskId if provided (for subtasks like "104.1")
	const displayId = originalTaskId || String(task.id);

	// Render description with markdown/HTML support (handles tiptap HTML)
	const renderedDescription = renderContent(task.description || '');

	// Format category with icon
	const categoryDisplay = task.category
		? `${getCategoryDisplay(task.category)}`
		: theme.muted('N/A');

	// Format skills as badges
	const skillsDisplay =
		task.skills && task.skills.length > 0
			? task.skills.map((s) => theme.accent(`[${s}]`)).join(' ')
			: theme.muted('N/A');

	// Build the left column (labels) and right column (values)
	const labels = [
		chalk.cyan('ID:'),
		chalk.cyan('Title:'),
		chalk.cyan('Status:'),
		chalk.cyan('Priority:'),
		chalk.cyan('Dependencies:'),
		chalk.cyan('Complexity:'),
		chalk.cyan('Category:'),
		chalk.cyan('Skills:'),
		chalk.cyan('Description:')
	].join('\n');

	const values = [
		displayId,
		task.title,
		getStatusWithColor(task.status),
		getPriorityWithColor(task.priority),
		deps,
		typeof task.complexity === 'number'
			? getComplexityWithColor(task.complexity)
			: theme.muted('N/A'),
		categoryDisplay,
		skillsDisplay,
		renderedDescription
	].join('\n');

	table.push([labels, values]);

	console.log(table.toString());
}

/**
 * Display implementation details in a box
 */
export function displayImplementationDetails(details: string): void {
	const terminalWidth = getContentWidth();
	const formattedDetails = renderContent(details);

	console.log(
		boxen(chalk.bold('Implementation Details:') + '\n\n' + formattedDetails, {
			padding: 1,
			borderStyle: 'round',
			borderColor: BORDER_COLOR,
			width: terminalWidth
		})
	);
}

/**
 * Display test strategy in a box
 */
export function displayTestStrategy(testStrategy: string): void {
	const terminalWidth = getContentWidth();
	const formattedStrategy = renderContent(testStrategy);

	console.log(
		boxen(chalk.bold('Test Strategy:') + '\n\n' + formattedStrategy, {
			padding: 1,
			borderStyle: 'round',
			borderColor: BORDER_COLOR,
			width: terminalWidth
		})
	);
}

/**
 * Display subtasks in a table format
 */
export function displaySubtasks(
	subtasks: Array<{
		id: string | number;
		title: string;
		status: any;
		description?: string;
		dependencies?: string[];
	}>,
	parentTaskId?: string | number
): void {
	const terminalWidth = getContentWidth();
	// Display subtasks header
	console.log(
		boxen(theme.heading('Subtasks'), {
			padding: { top: 0, bottom: 0, left: 1, right: 1 },
			borderColor: BORDER_COLOR,
			borderStyle: 'round',
			margin: { top: 1, bottom: 0 }
		})
	);

	// Create subtasks table
	const table = new Table({
		head: [
			theme.heading('ID'),
			theme.heading('Status'),
			theme.heading('Title'),
			theme.heading('Deps')
		],
		style: {
			head: [],
			border: TABLE_BORDER
		},
		colWidths: planColumns(terminalWidth, [
			{ key: 'id', width: 10 },
			{ key: 'status', width: 15 },
			{ key: 'title', width: 'flex' },
			{ key: 'deps', width: 8 }
		]).widths,
		wordWrap: true
	});

	subtasks.forEach((subtask) => {
		// Show the parent prefix (e.g., 10.1, 10.2)
		const subtaskId = parentTaskId
			? `${parentTaskId}.${subtask.id}`
			: String(subtask.id);

		// Format dependencies
		const deps =
			subtask.dependencies && subtask.dependencies.length > 0
				? subtask.dependencies.join(', ')
				: 'None';

		table.push([
			subtaskId,
			getStatusWithColor(subtask.status),
			subtask.title,
			deps
		]);
	});

	console.log(table.toString());
}

// ============================================================================
// AI Implementation Metadata Display Functions
// ============================================================================

/**
 * Display relevant files in a structured format
 */
export function displayRelevantFiles(files: RelevantFile[]): void {
	const terminalWidth = getContentWidth();

	const content = files
		.map((file) => {
			const actionIcon = getFileActionIcon(file.action);
			const path = theme.text(file.path);
			const desc = theme.muted(file.description);
			return `${actionIcon}  ${path}\n         ${desc}`;
		})
		.join('\n\n');

	console.log(
		boxen(chalk.bold('Files to Touch:') + '\n\n' + content, {
			padding: 1,
			borderStyle: 'round',
			borderColor: 'yellow',
			width: terminalWidth
		})
	);
}

/**
 * Display existing infrastructure to leverage
 */
export function displayExistingInfrastructure(
	infrastructure: ExistingInfrastructure[]
): void {
	const terminalWidth = getContentWidth();

	const content = infrastructure
		.map((infra) => {
			const name = chalk.cyan.bold(infra.name);
			const location = theme.muted(infra.location);
			const usage = theme.text(infra.usage);
			return `${name} → ${location}\n  ↳ ${usage}`;
		})
		.join('\n\n');

	console.log(
		boxen(chalk.bold('Leverage Existing Code:') + '\n\n' + content, {
			padding: 1,
			borderStyle: 'round',
			borderColor: BORDER_COLOR,
			width: terminalWidth
		})
	);
}

/**
 * Display scope boundaries (what's in/out of scope)
 */
export function displayScopeBoundaries(boundaries: ScopeBoundaries): void {
	const terminalWidth = getContentWidth();

	let content = '';

	if (boundaries.included) {
		content += chalk.green.bold('✓ In Scope:\n');
		content += theme.text('   ' + boundaries.included);
	}

	if (boundaries.excluded) {
		if (content) content += '\n\n';
		content += chalk.red.bold('✗ Out of Scope:\n');
		content += theme.muted('   ' + boundaries.excluded);
	}

	console.log(
		boxen(chalk.bold('Scope Boundaries:') + '\n\n' + content, {
			padding: 1,
			borderStyle: 'round',
			borderColor: BORDER_COLOR,
			width: terminalWidth
		})
	);
}

/**
 * Display acceptance criteria as a checklist
 */
export function displayAcceptanceCriteria(criteria: string[]): void {
	const terminalWidth = getContentWidth();

	const content = criteria.map((c) => theme.text(`☐ ${c}`)).join('\n');

	console.log(
		boxen(chalk.bold('Acceptance Criteria:') + '\n\n' + content, {
			padding: 1,
			borderStyle: 'round',
			borderColor: 'green',
			width: terminalWidth
		})
	);
}

/**
 * Display technical constraints
 */
export function displayTechnicalConstraints(constraints: string[]): void {
	const terminalWidth = getContentWidth();

	const content = constraints.map((c) => chalk.yellow(`▸ ${c}`)).join('\n');

	console.log(
		boxen(chalk.bold('Technical Constraints:') + '\n\n' + content, {
			padding: 1,
			borderStyle: 'round',
			borderColor: 'red',
			width: terminalWidth
		})
	);
}

/**
 * Display implementation approach (step-by-step guide)
 */
export function displayImplementationApproach(approach: string): void {
	const terminalWidth = getContentWidth();
	const formattedApproach = renderContent(approach);

	console.log(
		boxen(chalk.bold('Implementation Approach:') + '\n\n' + formattedApproach, {
			padding: 1,
			borderStyle: 'round',
			borderColor: BORDER_COLOR,
			width: terminalWidth
		})
	);
}

/**
 * Display codebase patterns to follow
 */
export function displayCodebasePatterns(patterns: string[]): void {
	const terminalWidth = getContentWidth();

	const content = patterns.map((p) => theme.text(`• ${p}`)).join('\n');

	console.log(
		boxen(chalk.bold('Codebase Patterns:') + '\n\n' + content, {
			padding: 1,
			borderStyle: 'round',
			...MUTED_BOX_BORDER,
			width: terminalWidth
		})
	);
}

/**
 * Display skills and category as inline badges
 */
export function displaySkillsAndCategory(
	category?: TaskCategory,
	skills?: string[]
): void {
	let output = '';

	if (category) {
		output +=
			theme.muted('Category: ') +
			chalk.cyan(`[${getCategoryDisplay(category)}]`);
	}

	if (skills && skills.length > 0) {
		if (output) output += '  ';
		output +=
			theme.muted('Skills: ') +
			skills.map((s) => theme.accent(`[${s}]`)).join(' ');
	}

	if (output) {
		console.log('\n' + output);
	}
}

/**
 * Display all implementation metadata for a task
 * Shows all AI-generated guidance when available
 * Note: Category and skills are displayed in the main properties table
 */
export function displayImplementationMetadata(task: Task | Subtask): void {
	const hasMetadata =
		task.relevantFiles ||
		task.existingInfrastructure ||
		task.scopeBoundaries ||
		task.acceptanceCriteria ||
		task.technicalConstraints ||
		task.implementationApproach ||
		task.codebasePatterns;

	if (!hasMetadata) {
		return;
	}

	// Display implementation approach
	if (task.implementationApproach) {
		console.log();
		displayImplementationApproach(task.implementationApproach);
	}

	// Display relevant files
	if (task.relevantFiles && task.relevantFiles.length > 0) {
		console.log();
		displayRelevantFiles(task.relevantFiles);
	}

	// Display existing infrastructure
	if (task.existingInfrastructure && task.existingInfrastructure.length > 0) {
		console.log();
		displayExistingInfrastructure(task.existingInfrastructure);
	}

	// Display codebase patterns
	if (task.codebasePatterns && task.codebasePatterns.length > 0) {
		console.log();
		displayCodebasePatterns(task.codebasePatterns);
	}

	// Display scope boundaries
	if (task.scopeBoundaries) {
		console.log();
		displayScopeBoundaries(task.scopeBoundaries);
	}

	// Display technical constraints
	if (task.technicalConstraints && task.technicalConstraints.length > 0) {
		console.log();
		displayTechnicalConstraints(task.technicalConstraints);
	}

	// Display acceptance criteria
	if (task.acceptanceCriteria && task.acceptanceCriteria.length > 0) {
		console.log();
		displayAcceptanceCriteria(task.acceptanceCriteria);
	}
}

// ============================================================================
// Suggested Actions
// ============================================================================

export { getSuggestedActions, type SuggestedAction };

/**
 * Display suggested actions
 */
export function displaySuggestedActions(
	taskId: string | number,
	status?: string,
	hasSubtasks: boolean = false
): void {
	const lines = getSuggestedActions(taskId, status, hasSubtasks).map(
		(action, index) =>
			`${chalk.cyan(`${index + 1}.`)} Run ${chalk.yellow(action.command)} ${action.description}`
	);
	console.log(
		boxen(chalk.bold('Suggested Actions:') + '\n\n' + lines.join('\n'), {
			padding: 1,
			margin: { top: 1 },
			borderStyle: 'round',
			borderColor: 'green',
			width: getContentWidth()
		})
	);
}

/**
 * Display complete task details - used by both show and start commands
 */
export function displayTaskDetails(
	task: Task | Subtask,
	options?: {
		statusFilter?: string;
		showSuggestedActions?: boolean;
		customHeader?: string;
		headerColor?: string;
		originalTaskId?: string;
	}
): void {
	const {
		statusFilter,
		showSuggestedActions = false,
		customHeader,
		headerColor = BORDER_COLOR,
		originalTaskId
	} = options || {};

	// Display header - either custom or default
	if (customHeader) {
		console.log(
			boxen(chalk.bold(customHeader), {
				padding: { top: 0, bottom: 0, left: 1, right: 1 },
				borderColor: headerColor,
				borderStyle: 'round',
				margin: { top: 1 }
			})
		);
	} else {
		// Use originalTaskId if provided (for subtasks like "104.1")
		const displayId = originalTaskId || task.id;
		displayTaskHeader(displayId, task.title);
	}

	// Display task properties in table format
	displayTaskProperties(task, originalTaskId);

	// Display implementation details if available
	if (task.details) {
		console.log(); // Empty line for spacing
		displayImplementationDetails(task.details);
	}

	// Display test strategy if available
	if ('testStrategy' in task && task.testStrategy) {
		console.log(); // Empty line for spacing
		displayTestStrategy(task.testStrategy as string);
	}

	// Display AI implementation metadata (relevantFiles, codebasePatterns, etc.)
	displayImplementationMetadata(task);

	// Display subtasks if available
	if (task.subtasks && task.subtasks.length > 0) {
		// Filter subtasks by status if provided
		const filteredSubtasks = statusFilter
			? task.subtasks.filter((sub) => sub.status === statusFilter)
			: task.subtasks;

		if (filteredSubtasks.length === 0 && statusFilter) {
			console.log(); // Empty line for spacing
			console.log(theme.muted(`  No subtasks with status '${statusFilter}'`));
		} else if (filteredSubtasks.length > 0) {
			console.log(); // Empty line for spacing
			displaySubtasks(filteredSubtasks, task.id);
		}
	}

	// Display suggested actions if requested
	if (showSuggestedActions) {
		console.log(); // Empty line for spacing
		const actionTaskId = originalTaskId || task.id;
		displaySuggestedActions(
			actionTaskId,
			task.status,
			Boolean(task.subtasks && task.subtasks.length > 0)
		);
	}
}
