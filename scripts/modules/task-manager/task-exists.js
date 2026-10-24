import { fullSubtaskId } from '@tm/core';

/**
 * Checks if a task with the given ID exists
 * @param {Array} tasks - Array of tasks to search
 * @param {string|number} taskId - ID of task or subtask to check
 * @returns {boolean} Whether the task exists
 */
function taskExists(tasks, taskId) {
	// Handle subtask IDs (e.g., "1.2")
	if (typeof taskId === 'string' && taskId.includes('.')) {
		const parts = taskId.split('.');
		// Validate that it's a proper subtask format (parentId.subtaskId)
		if (parts.length !== 2 || !parts[0] || !parts[1]) {
			// Invalid format - treat as regular task ID
			const id = String(parseInt(taskId, 10));
			return tasks.some((t) => String(t.id) === id);
		}

		const [parentIdStr, subtaskIdStr] = parts;
		const parentId = String(parseInt(parentIdStr, 10));
		const fullId = `${parentId}.${parseInt(subtaskIdStr, 10)}`;

		// Stored IDs may be numbers or strings, and a subtask's may be "1.2"
		const parentTask = tasks.find((t) => String(t.id) === parentId);
		return Boolean(
			Array.isArray(parentTask?.subtasks) &&
				parentTask.subtasks.some(
					(st) => fullSubtaskId(parentTask.id, st.id) === fullId
				)
		);
	}

	// Handle regular task IDs
	const id = String(parseInt(taskId, 10));
	return tasks.some((t) => String(t.id) === id);
}

export default taskExists;
