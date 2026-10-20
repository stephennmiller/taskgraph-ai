import path from 'path';
import boxen from 'boxen';
import chalk from 'chalk';
import Table from 'cli-table3';

import { BORDER_COLOR, theme } from '@tm/cli/theme';
import { displayBanner } from '../ui.js';
import { isSilentMode, log, readJSON, truncate, writeJSON } from '../utils.js';

/**
 * Clear subtasks from specified tasks
 * @param {string} tasksPath - Path to the tasks.json file
 * @param {string} taskIds - Task IDs to clear subtasks from
 * @param {Object} context - Context object containing projectRoot and tag
 * @param {string} [context.projectRoot] - Project root path
 * @param {string} [context.tag] - Tag for the task
 */
function clearSubtasks(tasksPath, taskIds, context = {}) {
	const { projectRoot, tag } = context;
	log('debug', `Reading tasks from ${tasksPath}...`);
	const data = readJSON(tasksPath, projectRoot, tag);
	if (!data || !data.tasks) {
		log('error', 'No valid tasks found.');
		process.exit(1);
	}

	// Handle multiple task IDs (comma-separated)
	const taskIdArray = taskIds.split(',').map((id) => id.trim());
	let clearedCount = 0;

	// Create a summary table for the cleared subtasks
	const summaryTable = new Table({
		head: [
			chalk.cyan.bold('Task ID'),
			chalk.cyan.bold('Task Title'),
			chalk.cyan.bold('Subtasks Cleared')
		],
		colWidths: [10, 50, 20],
		style: { head: [], border: [] }
	});

	taskIdArray.forEach((taskId) => {
		const id = parseInt(taskId, 10);
		if (Number.isNaN(id)) {
			log('error', `Invalid task ID: ${taskId}`);
			return;
		}

		const task = data.tasks.find((t) => t.id === id);
		if (!task) {
			log('error', `Task ${id} not found`);
			return;
		}

		if (!task.subtasks || task.subtasks.length === 0) {
			log('info', `Task ${id} has no subtasks to clear`);
			summaryTable.push([
				id.toString(),
				truncate(task.title, 47),
				chalk.yellow('No subtasks')
			]);
			return;
		}

		const subtaskCount = task.subtasks.length;
		task.subtasks = [];
		clearedCount++;
		log('debug', `Cleared ${subtaskCount} subtasks from task ${id}`);

		summaryTable.push([
			id.toString(),
			truncate(task.title, 47),
			chalk.green(
				`${subtaskCount} ${subtaskCount === 1 ? 'subtask' : 'subtasks'} cleared`
			)
		]);
	});

	if (clearedCount > 0) {
		writeJSON(tasksPath, data, projectRoot, tag);

		// Show summary table
		if (!isSilentMode()) {
			console.log(
				boxen(theme.text.bold('Subtask Clearing Summary:'), {
					padding: { left: 2, right: 2, top: 0, bottom: 0 },
					margin: { top: 1, bottom: 0 },
					borderColor: BORDER_COLOR,
					borderStyle: 'round'
				})
			);
			console.log(summaryTable.toString());
		}

		// Success message
		if (!isSilentMode()) {
			console.log(
				boxen(
					chalk.green(
						`Cleared subtasks from ${chalk.bold(clearedCount)} ${clearedCount === 1 ? 'task' : 'tasks'}`
					),
					{
						padding: 1,
						borderColor: 'green',
						borderStyle: 'round',
						margin: { top: 1 }
					}
				)
			);

			// Next steps suggestion
			console.log(
				boxen(
					theme.text.bold('Next Steps:') +
						'\n\n' +
						`${chalk.cyan('1.')} Run ${chalk.yellow('taskgraph expand --id=<id>')} to generate new subtasks\n` +
						`${chalk.cyan('2.')} Run ${chalk.yellow('taskgraph list --with-subtasks')} to verify changes`,
					{
						padding: 1,
						borderColor: 'cyan',
						borderStyle: 'round',
						margin: { top: 1 }
					}
				)
			);
		}
	} else {
		// The lines above already say why for each task
		log('info', 'No subtasks were cleared');
	}
}

export default clearSubtasks;
