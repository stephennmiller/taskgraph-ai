import { removeAllSubtasks } from '@tm/core';
import { log, readJSON, writeJSON } from '../utils.js';

/**
 * An error for a task ID that clearSubtasks can't act on. Nothing is cleared
 * when one is found, so a typo in a list of IDs changes nothing.
 */
class ClearSubtasksError extends Error {
	/**
	 * @param {'NO_TASKS'|'INVALID_TASK_ID'|'SUBTASK_ID'|'TASK_NOT_FOUND'} code
	 * @param {string} message
	 * @param {string} [taskId] - The ID as the user typed it
	 */
	constructor(code, message, taskId) {
		super(message);
		this.name = 'ClearSubtasksError';
		this.code = code;
		this.taskId = taskId;
	}
}

/**
 * Check each ID and find its task, before anything changes.
 * @returns {Array<Object>} The tasks, in the order given, without duplicates
 */
function resolveTasks(tasks, taskIds) {
	const ids = [
		...new Set(
			String(taskIds)
				.split(',')
				.map((id) => id.trim())
				.filter(Boolean)
		)
	];
	if (ids.length === 0) {
		throw new ClearSubtasksError('INVALID_TASK_ID', 'No task IDs given');
	}

	return ids.map((id) => {
		// parseInt('1.2') is 1, which used to clear every subtask of task 1
		if (/^\d+\.\d+/.test(id)) {
			throw new ClearSubtasksError(
				'SUBTASK_ID',
				`${id} is a subtask, not a task`,
				id
			);
		}
		if (!/^\d+$/.test(id)) {
			throw new ClearSubtasksError(
				'INVALID_TASK_ID',
				`"${id}" isn't a task ID`,
				id
			);
		}
		const task = tasks.find((t) => String(t.id) === id);
		if (!task) {
			throw new ClearSubtasksError(
				'TASK_NOT_FOUND',
				`Task ${id} not found`,
				id
			);
		}
		return task;
	});
}

/**
 * Remove every subtask from the given tasks.
 *
 * Prints nothing: the CLI formats the result, and MCP returns it.
 *
 * @param {string} tasksPath - Path to the tasks.json file
 * @param {string} taskIds - Comma-separated task IDs
 * @param {Object} context - Context object containing projectRoot and tag
 * @param {string} [context.projectRoot] - Project root path
 * @param {string} [context.tag] - Tag for the task
 * @returns {{cleared: Array<{id: number|string, title: string, count: number}>, empty: Array<{id: number|string, title: string}>}}
 *   Tasks whose subtasks were removed, and tasks that had none
 * @throws {ClearSubtasksError} If an ID is malformed, a subtask ID, or not found
 */
function clearSubtasks(tasksPath, taskIds, context = {}) {
	const { projectRoot, tag } = context;
	log('debug', `Reading tasks from ${tasksPath}...`);
	const data = readJSON(tasksPath, projectRoot, tag);
	if (!data || !data.tasks) {
		throw new ClearSubtasksError('NO_TASKS', 'No valid tasks found');
	}

	const tasks = resolveTasks(data.tasks, taskIds);
	const cleared = [];
	const empty = [];

	for (const task of tasks) {
		// Dependencies and links on the subtasks go with them
		const count = removeAllSubtasks(data.tasks, task);
		if (count === 0) {
			empty.push({ id: task.id, title: task.title });
			continue;
		}
		cleared.push({ id: task.id, title: task.title, count });
		log('debug', `Cleared ${count} subtasks from task ${task.id}`);
	}

	if (cleared.length > 0) {
		writeJSON(tasksPath, data, projectRoot, tag);
	}

	return { cleared, empty };
}

export default clearSubtasks;
