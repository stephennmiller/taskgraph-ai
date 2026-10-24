/**
 * dependency-manager.js
 * What move-task.js still needs to move tasks between tags: the cross-tag
 * dependency checks. Adding, removing, validating and fixing dependencies
 * live in @tm/core (modules/dependencies).
 */

import { log, traverseDependencies } from './utils.js';

/**
 * Structured error class for dependency operations
 */
class DependencyError extends Error {
	constructor(code, message, data = {}, options) {
		super(message, options);
		this.name = 'DependencyError';
		this.code = code;
		this.data = data;
	}
}

/**
 * Error codes for the cross-tag move checks
 */
const DEPENDENCY_ERROR_CODES = {
	CANNOT_MOVE_SUBTASK: 'CANNOT_MOVE_SUBTASK',
	INVALID_TASK_ID: 'INVALID_TASK_ID',
	INVALID_SOURCE_TAG: 'INVALID_SOURCE_TAG',
	INVALID_TARGET_TAG: 'INVALID_TARGET_TAG'
};

/**
 * Recursively find all dependencies for a set of tasks with depth limiting
 * Recursively find all dependencies for a set of tasks with depth limiting
 *
 * @note This function depends on the traverseDependencies utility from utils.js
 * for the actual dependency traversal logic.
 *
 * @param {Array} sourceTasks - Array of source tasks to find dependencies for
 * @param {Array} allTasks - Array of all available tasks
 * @param {Object} options - Options object
 * @param {number} options.maxDepth - Maximum recursion depth (default: 50)
 * @param {boolean} options.includeSelf - Whether to include self-references (default: false)
 * @returns {Array} Array of all dependency task IDs
 */
function findAllDependenciesRecursively(sourceTasks, allTasks, options = {}) {
	if (!Array.isArray(sourceTasks)) {
		throw new Error('Source tasks parameter must be an array');
	}
	if (!Array.isArray(allTasks)) {
		throw new Error('All tasks parameter must be an array');
	}
	return traverseDependencies(sourceTasks, allTasks, {
		...options,
		direction: 'forward',
		logger: { warn: log.warn || console.warn }
	});
}

/**
 * Find dependency task by ID, handling various ID formats
 * @param {string|number} depId - Dependency ID to find
 * @param {string} taskId - ID of the task that has this dependency
 * @param {Array} allTasks - Array of all tasks to search
 * @returns {Object|null} Found dependency task or null
 */
/**
 * Find a subtask within a parent task's subtasks array
 * @param {string} parentId - The parent task ID
 * @param {string|number} subtaskId - The subtask ID to find
 * @param {Array} allTasks - Array of all tasks to search in
 * @param {boolean} useStringComparison - Whether to use string comparison for subtaskId
 * @returns {Object|null} The found subtask with full ID or null if not found
 */
function findSubtaskInParent(
	parentId,
	subtaskId,
	allTasks,
	useStringComparison = false
) {
	// Convert parentId to numeric for proper comparison with top-level task IDs
	const numericParentId = parseInt(parentId, 10);
	const parentTask = allTasks.find((t) => t.id === numericParentId);

	if (parentTask && parentTask.subtasks && Array.isArray(parentTask.subtasks)) {
		const foundSubtask = parentTask.subtasks.find((subtask) =>
			useStringComparison
				? String(subtask.id) === String(subtaskId)
				: subtask.id === subtaskId
		);
		if (foundSubtask) {
			// Return a task-like object that represents the subtask with full ID
			return {
				...foundSubtask,
				id: `${parentId}.${foundSubtask.id}`
			};
		}
	}

	return null;
}

function findDependencyTask(depId, taskId, allTasks) {
	if (!depId) {
		return null;
	}

	// Convert depId to string for consistent comparison
	const depIdStr = String(depId);

	// Find the dependency task - handle both top-level and subtask IDs
	let depTask = null;

	// First try exact match (for top-level tasks)
	depTask = allTasks.find((t) => String(t.id) === depIdStr);

	// If not found and it's a subtask reference (contains dot), find the parent task first
	if (!depTask && depIdStr.includes('.')) {
		const [parentId, subtaskId] = depIdStr.split('.');
		depTask = findSubtaskInParent(parentId, subtaskId, allTasks, true);
	}

	// If still not found, try numeric comparison for relative subtask references
	if (!depTask && !isNaN(depId)) {
		const numericId = parseInt(depId, 10);
		// For subtasks, this might be a relative reference within the same parent
		if (taskId && typeof taskId === 'string' && taskId.includes('.')) {
			const [parentId] = taskId.split('.');
			depTask = findSubtaskInParent(parentId, numericId, allTasks, false);
		}
	}

	return depTask;
}

/**
 * Check if a task has cross-tag dependencies
 * @param {Object} task - Task to check
 * @param {string} targetTag - Target tag name
 * @param {Array} allTasks - Array of all tasks from all tags
 * @returns {Array} Array of cross-tag dependency conflicts
 */
function findTaskCrossTagConflicts(task, targetTag, allTasks) {
	const conflicts = [];

	// Validate task.dependencies is an array before processing
	if (!Array.isArray(task.dependencies) || task.dependencies.length === 0) {
		return conflicts;
	}

	// Filter out null/undefined dependencies and check each valid dependency
	const validDependencies = task.dependencies.filter((depId) => depId != null);

	validDependencies.forEach((depId) => {
		const depTask = findDependencyTask(depId, task.id, allTasks);

		if (depTask && depTask.tag !== targetTag) {
			conflicts.push({
				taskId: task.id,
				dependencyId: depId,
				dependencyTag: depTask.tag,
				message: `Task ${task.id} depends on ${depId} (in ${depTask.tag})`
			});
		}
	});

	return conflicts;
}

function validateCrossTagMove(task, sourceTag, targetTag, allTasks) {
	// Parameter validation
	if (!task || typeof task !== 'object') {
		throw new Error('Task parameter must be a valid object');
	}

	if (!sourceTag || typeof sourceTag !== 'string') {
		throw new Error('Source tag must be a valid string');
	}

	if (!targetTag || typeof targetTag !== 'string') {
		throw new Error('Target tag must be a valid string');
	}

	if (!Array.isArray(allTasks)) {
		throw new Error('All tasks parameter must be an array');
	}

	const conflicts = findTaskCrossTagConflicts(task, targetTag, allTasks);

	return {
		canMove: conflicts.length === 0,
		conflicts
	};
}

/**
 * Find all cross-tag dependencies for a set of tasks
 * @param {Array} sourceTasks - Array of tasks to check
 * @param {string} sourceTag - Source tag name
 * @param {string} targetTag - Target tag name
 * @param {Array} allTasks - Array of all tasks from all tags
 * @returns {Array} Array of cross-tag dependency conflicts
 */
function findCrossTagDependencies(sourceTasks, sourceTag, targetTag, allTasks) {
	// Parameter validation
	if (!Array.isArray(sourceTasks)) {
		throw new Error('Source tasks parameter must be an array');
	}

	if (!sourceTag || typeof sourceTag !== 'string') {
		throw new Error('Source tag must be a valid string');
	}

	if (!targetTag || typeof targetTag !== 'string') {
		throw new Error('Target tag must be a valid string');
	}

	if (!Array.isArray(allTasks)) {
		throw new Error('All tasks parameter must be an array');
	}

	const conflicts = [];

	sourceTasks.forEach((task) => {
		// Validate task object and dependencies array
		if (
			!task ||
			typeof task !== 'object' ||
			!Array.isArray(task.dependencies) ||
			task.dependencies.length === 0
		) {
			return;
		}

		// Use the shared helper function to find conflicts for this task
		const taskConflicts = findTaskCrossTagConflicts(task, targetTag, allTasks);
		conflicts.push(...taskConflicts);
	});

	return conflicts;
}

/**
 * Helper function to find all tasks that depend on a given task (reverse dependencies)
 * @param {string|number} taskId - The task ID to find dependencies for
 * @param {Array} allTasks - Array of all tasks to search
 * @param {Set} dependentTaskIds - Set to add found dependencies to
 */
function findTasksThatDependOn(taskId, allTasks, dependentTaskIds) {
	// Find the task object for the given ID
	const sourceTask = allTasks.find((t) => t.id === taskId);
	if (!sourceTask) {
		return;
	}

	// Use the shared utility for reverse dependency traversal
	const reverseDeps = traverseDependencies([sourceTask], allTasks, {
		direction: 'reverse',
		includeSelf: false,
		logger: { warn: log.warn || console.warn }
	});

	// Add all found reverse dependencies to the dependentTaskIds set
	reverseDeps.forEach((depId) => dependentTaskIds.add(depId));
}

/**
 * Helper function to check if a task depends on a source task
 * @param {Object} task - Task to check for dependencies
 * @param {Object} sourceTask - Source task to check dependency against
 * @returns {boolean} True if task depends on source task
 */
function taskDependsOnSource(task, sourceTask) {
	if (!task || !Array.isArray(task.dependencies)) {
		return false;
	}

	const sourceTaskIdStr = String(sourceTask.id);

	return task.dependencies.some((depId) => {
		if (!depId) return false;

		const depIdStr = String(depId);

		// Exact match
		if (depIdStr === sourceTaskIdStr) {
			return true;
		}

		// Handle subtask references
		if (
			sourceTaskIdStr &&
			typeof sourceTaskIdStr === 'string' &&
			sourceTaskIdStr.includes('.')
		) {
			// If source is a subtask, check if dependency references the parent
			const [parentId] = sourceTaskIdStr.split('.');
			if (depIdStr === parentId) {
				return true;
			}
		}

		// Handle relative subtask references
		if (
			depIdStr &&
			typeof depIdStr === 'string' &&
			depIdStr.includes('.') &&
			sourceTaskIdStr &&
			typeof sourceTaskIdStr === 'string' &&
			sourceTaskIdStr.includes('.')
		) {
			const [depParentId] = depIdStr.split('.');
			const [sourceParentId] = sourceTaskIdStr.split('.');
			if (depParentId === sourceParentId) {
				// Both are subtasks of the same parent, check if they reference each other
				const depSubtaskNum = parseInt(depIdStr.split('.')[1], 10);
				const sourceSubtaskNum = parseInt(sourceTaskIdStr.split('.')[1], 10);
				if (depSubtaskNum === sourceSubtaskNum) {
					return true;
				}
			}
		}

		return false;
	});
}

/**
 * Helper function to check if any subtasks of a task depend on source tasks
 * @param {Object} task - Task to check subtasks of
 * @param {Array} sourceTasks - Array of source tasks to check dependencies against
 * @returns {boolean} True if any subtasks depend on source tasks
 */
function subtasksDependOnSource(task, sourceTasks) {
	if (!task.subtasks || !Array.isArray(task.subtasks)) {
		return false;
	}

	return task.subtasks.some((subtask) => {
		// Check if this subtask depends on any source task
		const subtaskDependsOnSource = sourceTasks.some((sourceTask) =>
			taskDependsOnSource(subtask, sourceTask)
		);

		if (subtaskDependsOnSource) {
			return true;
		}

		// Recursively check if any nested subtasks depend on source tasks
		if (subtask.subtasks && Array.isArray(subtask.subtasks)) {
			return subtasksDependOnSource(subtask, sourceTasks);
		}

		return false;
	});
}

/**
 * Get all dependent task IDs for a set of cross-tag dependencies
 * @param {Array} sourceTasks - Array of source tasks
 * @param {Array} crossTagDependencies - Array of cross-tag dependency conflicts
 * @param {Array} allTasks - Array of all tasks from all tags
 * @returns {Array} Array of dependent task IDs to move
 */
function getDependentTaskIds(sourceTasks, crossTagDependencies, allTasks) {
	// Enhanced parameter validation
	if (!Array.isArray(sourceTasks)) {
		throw new Error('Source tasks parameter must be an array');
	}

	if (!Array.isArray(crossTagDependencies)) {
		throw new Error('Cross tag dependencies parameter must be an array');
	}

	if (!Array.isArray(allTasks)) {
		throw new Error('All tasks parameter must be an array');
	}

	// Use the shared recursive dependency finder
	const dependentTaskIds = new Set(
		findAllDependenciesRecursively(sourceTasks, allTasks, {
			includeSelf: false
		})
	);

	// Add immediate dependency IDs from conflicts and find their dependencies recursively
	const conflictTasksToProcess = [];
	crossTagDependencies.forEach((conflict) => {
		if (conflict && conflict.dependencyId) {
			const depId =
				typeof conflict.dependencyId === 'string'
					? parseInt(conflict.dependencyId, 10)
					: conflict.dependencyId;
			if (!isNaN(depId)) {
				dependentTaskIds.add(depId);
				// Find the task object for recursive dependency finding
				const depTask = allTasks.find((t) => t.id === depId);
				if (depTask) {
					conflictTasksToProcess.push(depTask);
				}
			}
		}
	});

	// Find dependencies of conflict tasks
	if (conflictTasksToProcess.length > 0) {
		const conflictDependencies = findAllDependenciesRecursively(
			conflictTasksToProcess,
			allTasks,
			{ includeSelf: false }
		);
		conflictDependencies.forEach((depId) => dependentTaskIds.add(depId));
	}

	// For --with-dependencies, we also need to find all dependencies of the source tasks
	sourceTasks.forEach((sourceTask) => {
		if (sourceTask && sourceTask.id) {
			// Find all tasks that this source task depends on (forward dependencies) - already handled above

			// Find all tasks that depend on this source task (reverse dependencies)
			findTasksThatDependOn(sourceTask.id, allTasks, dependentTaskIds);
		}
	});

	// Also include any tasks that depend on the source tasks
	sourceTasks.forEach((sourceTask) => {
		if (!sourceTask || typeof sourceTask !== 'object' || !sourceTask.id) {
			return; // Skip invalid source tasks
		}

		allTasks.forEach((task) => {
			// Validate task and dependencies array
			if (
				!task ||
				typeof task !== 'object' ||
				!Array.isArray(task.dependencies)
			) {
				return;
			}

			// Check if this task depends on the source task
			const hasDependency = taskDependsOnSource(task, sourceTask);

			// Check if any subtasks of this task depend on the source task
			const subtasksHaveDependency = subtasksDependOnSource(task, [sourceTask]);

			if (hasDependency || subtasksHaveDependency) {
				dependentTaskIds.add(task.id);
			}
		});
	});

	return Array.from(dependentTaskIds);
}

/**
 * Validate subtask movement - block direct cross-tag subtask moves
 * @param {string} taskId - Task ID to validate
 * @param {string} sourceTag - Source tag name
 * @param {string} targetTag - Target tag name
 * @throws {Error} If subtask movement is attempted
 */
function validateSubtaskMove(taskId, sourceTag, targetTag) {
	// Parameter validation
	if (!taskId || typeof taskId !== 'string') {
		throw new DependencyError(
			DEPENDENCY_ERROR_CODES.INVALID_TASK_ID,
			'Task ID must be a valid string'
		);
	}

	if (!sourceTag || typeof sourceTag !== 'string') {
		throw new DependencyError(
			DEPENDENCY_ERROR_CODES.INVALID_SOURCE_TAG,
			'Source tag must be a valid string'
		);
	}

	if (!targetTag || typeof targetTag !== 'string') {
		throw new DependencyError(
			DEPENDENCY_ERROR_CODES.INVALID_TARGET_TAG,
			'Target tag must be a valid string'
		);
	}

	if (taskId.includes('.')) {
		throw new DependencyError(
			DEPENDENCY_ERROR_CODES.CANNOT_MOVE_SUBTASK,
			`Cannot move subtask ${taskId} directly between tags.

First promote it to a full task using:
  taskgraph remove-subtask --id=${taskId} --convert`,
			{
				taskId,
				sourceTag,
				targetTag
			}
		);
	}
}

/**
 * Check if a task can be moved with its dependencies
 * @param {string} taskId - Task ID to check
 * @param {string} sourceTag - Source tag name
 * @param {string} targetTag - Target tag name
 * @param {Array} allTasks - Array of all tasks from all tags
 * @returns {Object} Object with canMove boolean and dependentTaskIds array
 */
function canMoveWithDependencies(taskId, sourceTag, targetTag, allTasks) {
	// Parameter validation
	if (!taskId || typeof taskId !== 'string') {
		throw new Error('Task ID must be a valid string');
	}

	if (!sourceTag || typeof sourceTag !== 'string') {
		throw new Error('Source tag must be a valid string');
	}

	if (!targetTag || typeof targetTag !== 'string') {
		throw new Error('Target tag must be a valid string');
	}

	if (!Array.isArray(allTasks)) {
		throw new Error('All tasks parameter must be an array');
	}

	// Enhanced task lookup to handle subtasks properly
	let sourceTask = null;

	// Check if it's a subtask ID (e.g., "1.2")
	if (taskId.includes('.')) {
		const [parentId, subtaskId] = taskId
			.split('.')
			.map((id) => parseInt(id, 10));
		const parentTask = allTasks.find(
			(t) => t.id === parentId && t.tag === sourceTag
		);

		if (
			parentTask &&
			parentTask.subtasks &&
			Array.isArray(parentTask.subtasks)
		) {
			const subtask = parentTask.subtasks.find((st) => st.id === subtaskId);
			if (subtask) {
				// Create a copy of the subtask with parent context
				sourceTask = {
					...subtask,
					parentTask: {
						id: parentTask.id,
						title: parentTask.title,
						status: parentTask.status
					},
					isSubtask: true
				};
			}
		}
	} else {
		// Regular task lookup - handle both string and numeric IDs
		sourceTask = allTasks.find((t) => {
			const taskIdNum = parseInt(taskId, 10);
			return (t.id === taskIdNum || t.id === taskId) && t.tag === sourceTag;
		});
	}

	if (!sourceTask) {
		return {
			canMove: false,
			dependentTaskIds: [],
			conflicts: [],
			error: 'Task not found'
		};
	}

	const validation = validateCrossTagMove(
		sourceTask,
		sourceTag,
		targetTag,
		allTasks
	);

	// Fix contradictory logic: return canMove: false when conflicts exist
	if (validation.canMove) {
		return {
			canMove: true,
			dependentTaskIds: [],
			conflicts: []
		};
	}

	// When conflicts exist, return canMove: false with conflicts and dependent task IDs
	const dependentTaskIds = getDependentTaskIds(
		[sourceTask],
		validation.conflicts,
		allTasks
	);

	return {
		canMove: false,
		dependentTaskIds,
		conflicts: validation.conflicts
	};
}

export {
	canMoveWithDependencies,
	findCrossTagDependencies,
	getDependentTaskIds,
	validateCrossTagMove,
	validateSubtaskMove
};
