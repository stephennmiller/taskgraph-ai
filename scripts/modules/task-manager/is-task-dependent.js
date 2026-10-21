import { resolveSubtaskDependency } from '@tm/core';

/**
 * Check if a task is dependent on another task (directly or indirectly)
 * Used to prevent circular dependencies
 * @param {Array} allTasks - Array of all tasks
 * @param {Object} task - The task to check
 * @param {number} targetTaskId - The task ID to check dependency against
 * @param {number|string} [parentId] - ID of the task that holds `task`, when
 *   it is a subtask (its bare numbers name siblings)
 * @returns {boolean} Whether the task depends on the target task
 */
function isTaskDependentOn(allTasks, task, targetTaskId, parentId) {
	const target = String(targetTaskId);

	// If the task is a subtask, check if its parent is the target
	if (task.parentTaskId !== undefined && String(task.parentTaskId) === target) {
		return true;
	}

	// Full IDs of what it depends on. Top-level task IDs are strings in tm-core
	// and numbers in older files.
	const fullDeps = (task.dependencies || []).map((dep) =>
		parentId === undefined
			? String(dep)
			: resolveSubtaskDependency(parentId, dep)
	);

	// Check direct dependencies
	if (fullDeps.includes(target)) {
		return true;
	}

	// Check dependencies of dependencies (recursive)
	for (const depId of fullDeps) {
		const depTask = allTasks.find((t) => String(t.id) === depId);
		if (depTask && isTaskDependentOn(allTasks, depTask, targetTaskId)) {
			return true;
		}
	}

	// Check subtasks for dependencies
	if (task.subtasks) {
		for (const subtask of task.subtasks) {
			if (isTaskDependentOn(allTasks, subtask, targetTaskId, task.id)) {
				return true;
			}
		}
	}

	return false;
}

export default isTaskDependentOn;
