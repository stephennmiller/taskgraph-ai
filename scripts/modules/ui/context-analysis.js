import { ui } from '@tm/cli';
import boxen from 'boxen';
import chalk from 'chalk';
import { isSilentMode, truncate } from '../utils.js';
import { theme, BORDER_COLOR } from './theme.js';

/**
 * Display context analysis results with beautiful formatting
 * @param {Object} analysisData - Analysis data from ContextGatherer
 * @param {string} semanticQuery - The original query used for semantic search
 * @param {number} contextSize - Size of gathered context in characters
 */
export function displayContextAnalysis(
	analysisData,
	semanticQuery,
	contextSize
) {
	if (isSilentMode() || !analysisData) return;

	const { highRelevance, mediumRelevance, recentTasks, allRelevantTasks } =
		analysisData;

	// Create the context analysis display
	let analysisContent = chalk.bold('Context Analysis') + '\n\n';

	// Query info
	analysisContent +=
		theme.muted('Query: ') + chalk.reset(`"${semanticQuery}"`) + '\n';
	analysisContent +=
		theme.muted('Context size: ') +
		chalk.cyan(`${contextSize.toLocaleString()} characters`) +
		'\n';
	analysisContent +=
		theme.muted('Tasks found: ') +
		chalk.yellow(`${allRelevantTasks.length} relevant tasks`) +
		'\n\n';

	// High relevance matches
	if (highRelevance.length > 0) {
		analysisContent += chalk.green.bold('High relevance matches:') + '\n';
		highRelevance.slice(0, 3).forEach((task) => {
			analysisContent +=
				chalk.green(`  • Task ${task.id}: ${truncate(task.title, 50)}`) + '\n';
		});
		if (highRelevance.length > 3) {
			analysisContent +=
				chalk.green(
					`  • ... and ${highRelevance.length - 3} more high relevance tasks`
				) + '\n';
		}
		analysisContent += '\n';
	}

	// Medium relevance matches
	if (mediumRelevance.length > 0) {
		analysisContent += chalk.yellow.bold('Medium relevance matches:') + '\n';
		mediumRelevance.slice(0, 3).forEach((task) => {
			analysisContent +=
				chalk.yellow(`  • Task ${task.id}: ${truncate(task.title, 50)}`) + '\n';
		});
		if (mediumRelevance.length > 3) {
			analysisContent +=
				chalk.yellow(
					`  • ... and ${mediumRelevance.length - 3} more medium relevance tasks`
				) + '\n';
		}
		analysisContent += '\n';
	}

	// Recent tasks (if they contributed)
	const recentTasksNotInRelevance = recentTasks.filter(
		(task) =>
			!highRelevance.some((hr) => hr.id === task.id) &&
			!mediumRelevance.some((mr) => mr.id === task.id)
	);

	if (recentTasksNotInRelevance.length > 0) {
		analysisContent += chalk.cyan.bold('Recent tasks (for context):') + '\n';
		recentTasksNotInRelevance.slice(0, 2).forEach((task) => {
			analysisContent +=
				chalk.cyan(`  • Task ${task.id}: ${truncate(task.title, 50)}`) + '\n';
		});
		if (recentTasksNotInRelevance.length > 2) {
			analysisContent +=
				chalk.cyan(
					`  • ... and ${recentTasksNotInRelevance.length - 2} more recent tasks`
				) + '\n';
		}
	}

	console.log(
		boxen(analysisContent, {
			padding: { top: 1, bottom: 1, left: 2, right: 2 },
			margin: { top: 1, bottom: 0 },
			borderStyle: 'round',
			borderColor: BORDER_COLOR,
			title: chalk.cyan('Context gathering'),
			titleAlignment: 'center'
		})
	);
}

export function displayAiUsageSummary(telemetryData, outputType = 'cli') {
	if (
		(outputType !== 'cli' && outputType !== 'text') ||
		!telemetryData ||
		isSilentMode()
	) {
		return; // Only display for CLI and if data exists and not in silent mode
	}

	// One quiet line instead of a 9-line box: the command, provider and a
	// $0.000000 cost told people nothing new
	const line = ui.formatUsageLine(telemetryData);
	if (line) {
		console.log(`\n${theme.muted(line)}`);
	}
}

/**
 * Confirm the subtasks `expand` just added, one line each
 * @param {number|string} parentId - The expanded task
 * @param {Array<{id: number|string, title: string}>} subtasks - The new subtasks only
 */
export function displayAddedSubtasks(parentId, subtasks) {
	if (isSilentMode() || !subtasks?.length) return;
	console.log(`\n${ui.formatAddedSubtasks(parentId, subtasks)}`);
}
