/**
 * Direct function wrapper for clearSubtasks
 */

import fs from 'fs';
import { clearSubtasks } from '../../../../scripts/modules/task-manager.js';
import {
	disableSilentMode,
	enableSilentMode,
	readJSON
} from '../../../../scripts/modules/utils.js';

/**
 * Clear subtasks from specified tasks
 * @param {Object} args - Function arguments
 * @param {string} args.tasksJsonPath - Explicit path to the tasks.json file.
 * @param {string} [args.id] - Task IDs (comma-separated) to clear subtasks from
 * @param {boolean} [args.all] - Clear subtasks from all tasks
 * @param {string} [args.tag] - Tag context to operate on (defaults to current active tag)
 * @param {string} [args.projectRoot] - Project root path (for MCP/env fallback)
 * @param {Object} log - Logger object
 * @returns {Promise<{success: boolean, data?: Object, error?: {code: string, message: string}}>}
 */
export async function clearSubtasksDirect(args, log) {
	// Destructure expected args
	const { tasksJsonPath, id, all, tag, projectRoot } = args;
	try {
		log.info(`Clearing subtasks with args: ${JSON.stringify(args)}`);

		// Check if tasksJsonPath was provided
		if (!tasksJsonPath) {
			log.error('clearSubtasksDirect called without tasksJsonPath');
			return {
				success: false,
				error: {
					code: 'MISSING_ARGUMENT',
					message: 'tasksJsonPath is required'
				}
			};
		}

		// Either id or all must be provided
		if (!id && !all) {
			return {
				success: false,
				error: {
					code: 'INPUT_VALIDATION_ERROR',
					message:
						'Either task IDs with id parameter or all parameter must be provided'
				}
			};
		}

		// Use provided path
		const tasksPath = tasksJsonPath;

		// Check if tasks.json exists
		if (!fs.existsSync(tasksPath)) {
			return {
				success: false,
				error: {
					code: 'FILE_NOT_FOUND_ERROR',
					message: `Tasks file not found at ${tasksPath}`
				}
			};
		}

		let taskIds;

		// Use readJSON which handles silent migration and tag resolution
		const data = readJSON(tasksPath, projectRoot, tag);

		if (!data || !data.tasks) {
			return {
				success: false,
				error: {
					code: 'INPUT_VALIDATION_ERROR',
					message: `No tasks found in tasks file: ${tasksPath}`
				}
			};
		}

		const currentTag = data.tag || tag;
		const tasks = data.tasks;

		// If all is specified, get all task IDs
		if (all) {
			log.info(`Clearing subtasks from all tasks in tag '${currentTag}'`);
			if (tasks.length === 0) {
				return {
					success: false,
					error: {
						code: 'INPUT_VALIDATION_ERROR',
						message: `No tasks found in tag context '${currentTag}'`
					}
				};
			}
			taskIds = tasks.map((t) => t.id).join(',');
		} else {
			// Use the provided task IDs
			taskIds = id;
		}

		log.info(`Clearing subtasks from tasks: ${taskIds} in tag '${currentTag}'`);

		// clearSubtasks returns what it changed; silent mode keeps its debug
		// logs off stdout, which carries the MCP protocol
		enableSilentMode();
		let result;
		try {
			result = clearSubtasks(tasksPath, taskIds, {
				projectRoot,
				tag: currentTag
			});
		} finally {
			disableSilentMode();
		}
		const { cleared, empty } = result;
		const subtasksCleared = cleared.reduce((sum, t) => sum + t.count, 0);

		return {
			success: true,
			data: {
				message:
					cleared.length > 0
						? `Cleared ${subtasksCleared} subtask(s) from ${cleared.length} task(s) in tag '${currentTag}'`
						: `No subtasks to clear in tag '${currentTag}'`,
				tasksCleared: cleared.map(({ id, title, count }) => ({
					id,
					title,
					subtasksCleared: count
				})),
				tasksWithoutSubtasks: empty,
				tag: currentTag
			}
		};
	} catch (error) {
		log.error(`Error in clearSubtasksDirect: ${error.message}`);
		return {
			success: false,
			error: {
				code:
					error.name === 'ClearSubtasksError'
						? 'INPUT_VALIDATION_ERROR'
						: 'CORE_FUNCTION_ERROR',
				message: error.message
			}
		};
	}
}
