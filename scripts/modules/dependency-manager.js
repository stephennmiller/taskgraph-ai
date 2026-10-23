/**
 * dependency-manager.js
 * Manages task dependencies and relationships
 */

import {
	assignMetadata,
	checkPrdCoverage,
	findDanglingLinks,
	getLinkType,
	hasDependency,
	isSiblingReference,
	parseLinkType,
	pruneDependencySources,
	pruneTaskLinks,
	removeTaskLink,
	resolveSubtaskDependency,
	setDependencySource,
	setTaskLink
} from '@tm/core';
import path from 'path';
import { displayBanner } from './ui.js';
import {
	formatTaskId,
	log,
	readJSON,
	taskExists,
	traverseDependencies,
	writeJSON
} from './utils.js';

const LIST_HINT = 'Run `taskgraph list` to see task IDs';
const LINK_TYPE_HINT = 'Use --type=blocks, related or discovered-from';

/** `related to task 3`, `discovered from task 3` */
function describeLink(type, dependencyId) {
	return type === 'related'
		? `related to task ${dependencyId}`
		: `marked as discovered from task ${dependencyId}`;
}

/**
 * Link a task to another without making it wait: a `related` or
 * `discovered-from` link. A blocking dependency on the same task becomes the
 * link, so the task stops waiting for it.
 * @returns {boolean} Whether anything changed
 */
function linkWithoutBlocking(task, taskId, dependencyId, type, parentId) {
	const current = getLinkType(task, dependencyId, parentId);
	if (current === type) {
		log(
			'info',
			`Task ${taskId} is already ${describeLink(type, dependencyId)}; nothing changed`
		);
		return false;
	}
	if (current === 'blocks') {
		const fullId = (dep) =>
			parentId === undefined
				? String(dep)
				: resolveSubtaskDependency(parentId, dep);
		task.dependencies = task.dependencies.filter(
			(dep) => fullId(dep) !== String(dependencyId)
		);
		setTaskDependencySource(task, dependencyId, 'explicit', parentId);
	}
	assignMetadata(task, setTaskLink(task.metadata, dependencyId, type));
	log(
		'success',
		`Task ${taskId} is now ${describeLink(type, dependencyId)}` +
			(current === 'blocks' ? ' and no longer waits for it' : '')
	);
	return true;
}
const NO_TASKS_HINT = 'Create some with `taskgraph parse-prd <file>`';

/**
 * Record how a dependency was created on the task's metadata. Marking it
 * explicit drops any inferred entry, which is also how removal prunes one.
 * @param {object} task
 * @param {string|number} dependencyId
 * @param {'explicit'|'inferred'} source
 * @param {string|number} [parentId] - Parent task ID when `task` is a subtask
 */
function setTaskDependencySource(task, dependencyId, source, parentId) {
	assignMetadata(
		task,
		setDependencySource(task.metadata, dependencyId, source, parentId)
	);
}

/**
 * Drop provenance marks for dependencies that no longer exist, on every task
 * and subtask, after a bulk fix removed some.
 * @param {Array} tasks
 */
function pruneProvenance(tasks) {
	for (const task of tasks || []) {
		if (task.metadata) assignMetadata(task, pruneDependencySources(task));
		for (const subtask of task.subtasks || []) {
			if (subtask.metadata) {
				assignMetadata(subtask, pruneDependencySources(subtask, task.id));
			}
		}
	}
}

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
 * Error codes for dependency operations
 */
const DEPENDENCY_ERROR_CODES = {
	NO_TASKS: 'NO_TASKS',
	TASK_NOT_FOUND: 'TASK_NOT_FOUND',
	NO_SUBTASKS: 'NO_SUBTASKS',
	SELF_DEPENDENCY: 'SELF_DEPENDENCY',
	CIRCULAR_DEPENDENCY: 'CIRCULAR_DEPENDENCY',
	FIX_FAILED: 'FIX_FAILED',
	CANNOT_MOVE_SUBTASK: 'CANNOT_MOVE_SUBTASK',
	INVALID_TASK_ID: 'INVALID_TASK_ID',
	INVALID_LINK_TYPE: 'INVALID_LINK_TYPE',
	INVALID_SOURCE_TAG: 'INVALID_SOURCE_TAG',
	INVALID_TARGET_TAG: 'INVALID_TARGET_TAG'
};

/**
 * A dependency command stops with one clear message. It throws instead of
 * exiting so the MCP server survives: the CLI prints the error (with `hint`
 * as its suggestion) and the MCP direct functions return it as a result.
 * @param {string} code - One of DEPENDENCY_ERROR_CODES
 * @param {string} message
 * @param {string} [hint]
 * @param {Error} [cause] - The error this one reports, kept for its stack
 * @returns {DependencyError}
 */
function failure(code, message, hint, cause) {
	return new DependencyError(code, message, { hint }, cause && { cause });
}

/**
 * Add a dependency to a task, or a link that doesn't block it
 * @param {string} tasksPath - Path to the tasks.json file
 * @param {number|string} taskId - ID of the task to add dependency to
 * @param {number|string} dependencyId - ID of the task to add as dependency
 * @param {Object} context - Context object containing projectRoot and tag information
 * @param {string} [context.projectRoot] - Project root path
 * @param {string} [context.tag] - Tag for the task
 * @param {string} [context.linkType] - `blocks` (the default), or `related`
 *   / `discovered-from` for a link that never holds the task back
 */
async function addDependency(tasksPath, taskId, dependencyId, context = {}) {
	log('debug', `Adding dependency ${dependencyId} to task ${taskId}...`);

	const linkType = parseLinkType(context.linkType);
	if (!linkType) {
		throw failure(
			DEPENDENCY_ERROR_CODES.INVALID_LINK_TYPE,
			`"${context.linkType}" isn't a link type`,
			LINK_TYPE_HINT
		);
	}

	const data = readJSON(tasksPath, context.projectRoot, context.tag);
	if (!data || !data.tasks) {
		throw failure(
			DEPENDENCY_ERROR_CODES.NO_TASKS,
			'No tasks yet',
			NO_TASKS_HINT
		);
	}

	// Format the task and dependency IDs correctly
	const formattedTaskId =
		typeof taskId === 'string' && taskId.includes('.')
			? taskId
			: parseInt(taskId, 10);

	const formattedDependencyId = formatTaskId(dependencyId);

	// Check if the dependency task or subtask actually exists
	if (!taskExists(data.tasks, formattedDependencyId)) {
		throw failure(
			DEPENDENCY_ERROR_CODES.TASK_NOT_FOUND,
			`Task ${formattedDependencyId} not found`,
			LIST_HINT
		);
	}

	// Find the task to update
	let targetTask = null;
	let isSubtask = false;
	let provenanceParent;

	if (typeof formattedTaskId === 'string' && formattedTaskId.includes('.')) {
		// Handle dot notation for subtasks (e.g., "1.2")
		const [parentId, subtaskId] = formattedTaskId
			.split('.')
			.map((id) => parseInt(id, 10));
		const parentTask = data.tasks.find((t) => t.id === parentId);

		if (!parentTask) {
			throw failure(
				DEPENDENCY_ERROR_CODES.TASK_NOT_FOUND,
				`Task ${parentId} not found`,
				LIST_HINT
			);
		}

		if (!parentTask.subtasks) {
			throw failure(
				DEPENDENCY_ERROR_CODES.NO_SUBTASKS,
				`Task ${parentId} has no subtasks`,
				`Add some with \`taskgraph expand --id=${parentId}\``
			);
		}

		targetTask = parentTask.subtasks.find((s) => s.id === subtaskId);
		isSubtask = true;
		provenanceParent = parentId;

		if (!targetTask) {
			throw failure(
				DEPENDENCY_ERROR_CODES.TASK_NOT_FOUND,
				`Subtask ${formattedTaskId} not found`,
				LIST_HINT
			);
		}
	} else {
		// Regular task (not a subtask)
		targetTask = data.tasks.find((t) => t.id === formattedTaskId);

		if (!targetTask) {
			throw failure(
				DEPENDENCY_ERROR_CODES.TASK_NOT_FOUND,
				`Task ${formattedTaskId} not found`,
				LIST_HINT
			);
		}
	}

	// Initialize dependencies array if it doesn't exist
	if (!targetTask.dependencies) {
		targetTask.dependencies = [];
	}

	// A related or discovered-from link is kept apart from the dependencies,
	// so it can't hold the task back and can't make a loop
	if (linkType !== 'blocks') {
		if (String(formattedTaskId) === String(formattedDependencyId)) {
			throw failure(
				DEPENDENCY_ERROR_CODES.SELF_DEPENDENCY,
				`Task ${formattedTaskId} can't link to itself`
			);
		}
		const changed = linkWithoutBlocking(
			targetTask,
			formattedTaskId,
			String(formattedDependencyId),
			linkType,
			provenanceParent
		);
		if (changed) writeJSON(tasksPath, data, context.projectRoot, context.tag);
		return;
	}

	// Check if dependency already exists (a subtask sibling may be stored as 1 or "2.1")
	if (hasDependency(targetTask, formattedDependencyId, provenanceParent)) {
		// Adding it by hand makes an AI-inferred dependency explicit
		const before = JSON.stringify(targetTask.metadata);
		setTaskDependencySource(
			targetTask,
			formattedDependencyId,
			'explicit',
			provenanceParent
		);
		if (JSON.stringify(targetTask.metadata) !== before) {
			writeJSON(tasksPath, data, context.projectRoot, context.tag);
			log(
				'success',
				`Task ${formattedTaskId} now lists task ${formattedDependencyId} as an explicit dependency`
			);
			return;
		}
		log(
			'info',
			`Task ${formattedTaskId} already depends on task ${formattedDependencyId}; nothing changed`
		);
		return;
	}

	// Check if the task is trying to depend on itself - compare full IDs (including subtask parts)
	if (String(formattedTaskId) === String(formattedDependencyId)) {
		throw failure(
			DEPENDENCY_ERROR_CODES.SELF_DEPENDENCY,
			`Task ${formattedTaskId} can't depend on itself`
		);
	}

	// For subtasks of the same parent, we need to make sure we're not treating it as a self-dependency
	// Check if we're dealing with subtasks with the same parent task
	let isSelfDependency = false;

	if (
		typeof formattedTaskId === 'string' &&
		typeof formattedDependencyId === 'string' &&
		formattedTaskId.includes('.') &&
		formattedDependencyId.includes('.')
	) {
		const [taskParentId] = formattedTaskId.split('.');
		const [depParentId] = formattedDependencyId.split('.');

		// Only treat it as a self-dependency if both the parent ID and subtask ID are identical
		isSelfDependency = formattedTaskId === formattedDependencyId;

		// Log for debugging
		log(
			'debug',
			`Adding dependency between subtasks: ${formattedTaskId} depends on ${formattedDependencyId}`
		);
		log(
			'debug',
			`Parent IDs: ${taskParentId} and ${depParentId}, Self-dependency check: ${isSelfDependency}`
		);
	}

	if (isSelfDependency) {
		throw failure(
			DEPENDENCY_ERROR_CODES.SELF_DEPENDENCY,
			`Subtask ${formattedTaskId} can't depend on itself`
		);
	}

	// Check for circular dependencies
	const dependencyChain = [formattedTaskId];
	if (
		!isCircularDependency(data.tasks, formattedDependencyId, dependencyChain)
	) {
		// Add the dependency; a non-blocking link to the same task gives way
		targetTask.dependencies.push(formattedDependencyId);
		assignMetadata(
			targetTask,
			removeTaskLink(targetTask.metadata, formattedDependencyId)
		);
		// A person added it, so it is explicit (clears any stale inferred mark)
		setTaskDependencySource(
			targetTask,
			formattedDependencyId,
			'explicit',
			provenanceParent
		);

		// Sort dependencies numerically or by parent task ID first, then subtask ID
		targetTask.dependencies.sort((a, b) => {
			if (typeof a === 'number' && typeof b === 'number') {
				return a - b;
			} else if (typeof a === 'string' && typeof b === 'string') {
				const [aParent, aChild] = a.split('.').map(Number);
				const [bParent, bChild] = b.split('.').map(Number);
				return aParent !== bParent ? aParent - bParent : aChild - bChild;
			} else if (typeof a === 'number') {
				return -1; // Numbers come before strings
			} else {
				return 1; // Strings come after numbers
			}
		});

		// Save changes
		writeJSON(tasksPath, data, context.projectRoot, context.tag);
		// One line, like the other quick edits: this runs often and a box
		// repeated it
		log(
			'success',
			`Task ${formattedTaskId} now depends on task ${formattedDependencyId}`
		);

		// Generate updated task files
		// await generateTaskFiles(tasksPath, path.dirname(tasksPath));

		log('debug', 'Task files regenerated with updated dependencies.');
	} else {
		throw failure(
			DEPENDENCY_ERROR_CODES.CIRCULAR_DEPENDENCY,
			`That would make a loop: task ${formattedDependencyId} already depends on task ${formattedTaskId}`,
			`Run \`taskgraph graph\` to see how they connect`
		);
	}
}

/**
 * Remove a dependency from a task
 * @param {string} tasksPath - Path to the tasks.json file
 * @param {number|string} taskId - ID of the task to remove dependency from
 * @param {number|string} dependencyId - ID of the task to remove as dependency
 * @param {Object} context - Context object containing projectRoot and tag information
 * @param {string} [context.projectRoot] - Project root path
 * @param {string} [context.tag] - Tag for the task
 */
async function removeDependency(tasksPath, taskId, dependencyId, context = {}) {
	log('debug', `Removing dependency ${dependencyId} from task ${taskId}...`);

	// Read tasks file
	const data = readJSON(tasksPath, context.projectRoot, context.tag);
	if (!data || !data.tasks) {
		throw failure(
			DEPENDENCY_ERROR_CODES.NO_TASKS,
			'No tasks yet',
			NO_TASKS_HINT
		);
	}

	// Format the task and dependency IDs correctly
	const formattedTaskId =
		typeof taskId === 'string' && taskId.includes('.')
			? taskId
			: parseInt(taskId, 10);

	const formattedDependencyId = formatTaskId(dependencyId);

	// Find the task to update
	let targetTask = null;
	let isSubtask = false;

	if (typeof formattedTaskId === 'string' && formattedTaskId.includes('.')) {
		// Handle dot notation for subtasks (e.g., "1.2")
		const [parentId, subtaskId] = formattedTaskId
			.split('.')
			.map((id) => parseInt(id, 10));
		const parentTask = data.tasks.find((t) => t.id === parentId);

		if (!parentTask) {
			throw failure(
				DEPENDENCY_ERROR_CODES.TASK_NOT_FOUND,
				`Task ${parentId} not found`,
				LIST_HINT
			);
		}

		if (!parentTask.subtasks) {
			throw failure(
				DEPENDENCY_ERROR_CODES.NO_SUBTASKS,
				`Task ${parentId} has no subtasks`,
				`Add some with \`taskgraph expand --id=${parentId}\``
			);
		}

		targetTask = parentTask.subtasks.find((s) => s.id === subtaskId);
		isSubtask = true;

		if (!targetTask) {
			throw failure(
				DEPENDENCY_ERROR_CODES.TASK_NOT_FOUND,
				`Subtask ${formattedTaskId} not found`,
				LIST_HINT
			);
		}
	} else {
		// Regular task (not a subtask)
		targetTask = data.tasks.find((t) => t.id === formattedTaskId);

		if (!targetTask) {
			throw failure(
				DEPENDENCY_ERROR_CODES.TASK_NOT_FOUND,
				`Task ${formattedTaskId} not found`,
				LIST_HINT
			);
		}
	}

	// A related or discovered-from link is removed the same way
	const linkType = getLinkType(
		targetTask,
		formattedDependencyId,
		isSubtask ? formattedTaskId.split('.')[0] : undefined
	);
	if (linkType && linkType !== 'blocks') {
		assignMetadata(
			targetTask,
			removeTaskLink(targetTask.metadata, formattedDependencyId)
		);
		writeJSON(tasksPath, data, context.projectRoot, context.tag);
		log(
			'success',
			`Task ${formattedTaskId} is no longer linked to task ${formattedDependencyId}`
		);
		return;
	}

	// Check if the task has any dependencies
	if (!targetTask.dependencies || targetTask.dependencies.length === 0) {
		log('info', `Task ${formattedTaskId} has no dependencies; nothing changed`);
		return;
	}

	// Normalize the dependency ID for comparison to handle different formats
	const normalizedDependencyId = String(formattedDependencyId);

	// Check if the dependency exists by comparing string representations
	// On a subtask a bare number is a sibling (stored 1 for "1.1"), a string
	// without a dot is a task
	const dependencyIndex = targetTask.dependencies.findIndex((dep) => {
		const full = isSubtask
			? resolveSubtaskDependency(formattedTaskId.split('.')[0], dep)
			: String(dep);
		return full === normalizedDependencyId;
	});

	if (dependencyIndex === -1) {
		log(
			'info',
			`Task ${formattedTaskId} doesn't depend on task ${formattedDependencyId}; nothing changed`
		);
		return;
	}

	// Remove the dependency, and its provenance mark with it
	const [removedDependency] = targetTask.dependencies.splice(
		dependencyIndex,
		1
	);
	setTaskDependencySource(
		targetTask,
		removedDependency,
		'explicit',
		isSubtask ? formattedTaskId.split('.')[0] : undefined
	);

	// Save the updated tasks
	writeJSON(tasksPath, data, context.projectRoot, context.tag);

	log(
		'success',
		`Task ${formattedTaskId} no longer depends on task ${formattedDependencyId}`
	);

	// Regenerate task files
	// await generateTaskFiles(tasksPath, path.dirname(tasksPath));
}

/**
 * Check if adding a dependency would create a circular dependency
 * @param {Array} tasks - Array of all tasks
 * @param {number|string} taskId - ID of task to check
 * @param {Array} chain - Chain of dependencies to check
 * @returns {boolean} True if circular dependency would be created
 */
function isCircularDependency(tasks, taskId, chain = []) {
	// Convert taskId to string for comparison
	const taskIdStr = String(taskId);

	// If we've seen this task before in the chain, we have a circular dependency
	if (chain.some((id) => String(id) === taskIdStr)) {
		return true;
	}

	// Find the task or subtask
	let task = null;
	let parentIdForSubtask = null;

	// Check if this is a subtask reference (e.g., "1.2")
	if (taskIdStr.includes('.')) {
		const [parentId, subtaskId] = taskIdStr.split('.').map(Number);
		const parentTask = tasks.find((t) => t.id === parentId);
		parentIdForSubtask = parentId; // Store parent ID if it's a subtask

		if (parentTask && parentTask.subtasks) {
			task = parentTask.subtasks.find((st) => st.id === subtaskId);
		}
	} else {
		// Regular task - handle both string and numeric task IDs
		const taskIdNum = parseInt(taskIdStr, 10);
		task = tasks.find((t) => t.id === taskIdNum || String(t.id) === taskIdStr);
	}

	if (!task) {
		return false; // Task doesn't exist, can't create circular dependency
	}

	// No dependencies, can't create circular dependency
	if (!task.dependencies || task.dependencies.length === 0) {
		return false;
	}

	// Check each dependency recursively
	const newChain = [...chain, taskIdStr]; // Use taskIdStr for consistency
	return task.dependencies.some((depId) => {
		// A subtask's bare number names a sibling, a string without a dot a task
		const normalizedDepId =
			parentIdForSubtask !== null
				? resolveSubtaskDependency(parentIdForSubtask, depId)
				: String(depId);
		// Pass the normalized ID to the recursive call
		return isCircularDependency(tasks, normalizedDepId, newChain);
	});
}

/**
 * Every task and subtask's dependencies as full IDs ("3", "3.2"), without
 * self-dependencies, which are reported on their own. A bare number in a
 * subtask's dependencies is a sibling subtask.
 * @param {Array} tasks - All tasks
 * @param {Object} [options]
 * @param {boolean} [options.subtasksOnly] - Keep only edges between subtasks,
 *   the ones fix-dependencies can break
 * @returns {Map<string, string[]>}
 */
function buildDependencyGraph(tasks, { subtasksOnly = false } = {}) {
	const graph = new Map();
	const add = (id, deps) => {
		const edges = deps.filter(
			(dep) => dep !== id && (!subtasksOnly || dep.includes('.'))
		);
		graph.set(id, edges);
	};

	for (const task of tasks) {
		const taskId = String(task.id);
		if (!subtasksOnly) add(taskId, (task.dependencies || []).map(String));
		for (const subtask of task.subtasks || []) {
			add(
				`${taskId}.${subtask.id}`,
				(subtask.dependencies || []).map((dep) =>
					resolveSubtaskDependency(taskId, dep)
				)
			);
		}
	}
	return graph;
}

/**
 * The IDs that are in a loop: one of their dependencies leads back to them.
 * A task that only depends on a loop is not in it. These are the members of
 * strongly connected components of two or more nodes (Tarjan's algorithm, one
 * pass), so the cost grows with the size of the graph, not its square. It is
 * iterative, so a long chain cannot overflow the stack. Self-dependencies are
 * not in the graph, so they never count as a loop.
 * @param {Map<string, string[]>} graph - From buildDependencyGraph
 * @returns {Set<string>} Full task and subtask IDs
 */
function findLoopMembers(graph) {
	const index = new Map();
	const lowLink = new Map();
	const onStack = new Set();
	const stack = [];
	const members = new Set();
	let counter = 0;

	const enter = (id) => {
		index.set(id, counter);
		lowLink.set(id, counter);
		counter++;
		stack.push(id);
		onStack.add(id);
		return { id, edges: graph.get(id), next: 0 };
	};

	for (const root of graph.keys()) {
		if (index.has(root)) continue;

		const work = [enter(root)];
		while (work.length > 0) {
			const frame = work[work.length - 1];
			if (frame.next < frame.edges.length) {
				const to = frame.edges[frame.next++];
				// A dependency on itself is a loop of one, as a search from it finds
				if (to === frame.id) members.add(to);
				// An ID that is not a task or subtask has no edges, so no way back
				if (!graph.has(to)) continue;
				if (!index.has(to)) {
					work.push(enter(to));
				} else if (onStack.has(to)) {
					lowLink.set(frame.id, Math.min(lowLink.get(frame.id), index.get(to)));
				}
				continue;
			}

			work.pop();
			if (lowLink.get(frame.id) === index.get(frame.id)) {
				const component = [];
				let id;
				do {
					id = stack.pop();
					onStack.delete(id);
					component.push(id);
				} while (id !== frame.id);
				if (component.length > 1) {
					for (const member of component) members.add(member);
				}
			}
			const parent = work[work.length - 1];
			if (parent) {
				lowLink.set(
					parent.id,
					Math.min(lowLink.get(parent.id), lowLink.get(frame.id))
				);
			}
		}
	}
	return members;
}

/**
 * Answers `taskExists(tasks, id)` from an index, for checks that ask once per
 * dependency. Same answers: an ID names a task by its number, or a subtask
 * "parent.sub" (anything after a second dot is ignored).
 * @param {Array} tasks - All tasks
 * @returns {(id: string|number) => boolean}
 */
function createTaskLookup(tasks) {
	// Task ID -> its subtask IDs (null when it has none); the first task wins
	const subtaskIds = new Map();
	for (const task of tasks) {
		if (subtaskIds.has(task.id)) continue;
		subtaskIds.set(
			task.id,
			task.subtasks ? new Set(task.subtasks.map((st) => st.id)) : null
		);
	}

	return (id) => {
		if (!id) return false;
		if (typeof id === 'string' && id.includes('.')) {
			const [parentId, subtaskId] = id.split('.').map((n) => parseInt(n, 10));
			// Set lookups match NaN with NaN; taskExists never does
			if (Number.isNaN(parentId) || Number.isNaN(subtaskId)) return false;
			return subtaskIds.get(parentId)?.has(subtaskId) ?? false;
		}
		const taskId = parseInt(id, 10);
		return !Number.isNaN(taskId) && subtaskIds.has(taskId);
	};
}

/**
 * Validate task dependencies
 * @param {Array} tasks - Array of all tasks
 * @returns {Object} Validation result with valid flag and issues array
 */
function validateTaskDependencies(tasks) {
	const issues = [];
	const graph = buildDependencyGraph(tasks);
	const loopMembers = findLoopMembers(graph);
	const subtaskLoopMembers = findLoopMembers(
		buildDependencyGraph(tasks, { subtasksOnly: true })
	);
	const exists = createTaskLookup(tasks);

	// Check each task's dependencies
	tasks.forEach((task) => {
		if (!task.dependencies) {
			return; // No dependencies to validate
		}

		task.dependencies.forEach((depId) => {
			// Check for self-dependencies
			if (String(depId) === String(task.id)) {
				issues.push({
					type: 'self',
					taskId: task.id,
					message: `Task ${task.id} depends on itself`
				});
				return;
			}

			// Check if dependency exists
			if (!exists(depId)) {
				issues.push({
					type: 'missing',
					taskId: task.id,
					dependencyId: depId,
					message: `Task ${task.id} depends on non-existent task ${depId}`
				});
			}
		});

		// Check for loops. Self-dependencies were reported above and aren't
		// in the graph, so they aren't reported again as a loop.
		if (loopMembers.has(String(task.id))) {
			issues.push({
				type: 'circular',
				taskId: task.id,
				// A loop through a task needs the user to choose which edge goes
				fixable: false,
				message: `Task ${task.id} is part of a circular dependency chain`
			});
		}

		// Check subtask dependencies if they exist
		if (task.subtasks && task.subtasks.length > 0) {
			task.subtasks.forEach((subtask) => {
				if (!subtask.dependencies) {
					return; // No dependencies to validate
				}

				// Create a full subtask ID for reference
				const fullSubtaskId = `${task.id}.${subtask.id}`;

				subtask.dependencies.forEach((depId) => {
					// Check for self-dependencies in subtasks
					if (
						String(depId) === String(fullSubtaskId) ||
						(isSiblingReference(depId) && depId === subtask.id)
					) {
						issues.push({
							type: 'self',
							taskId: fullSubtaskId,
							message: `Subtask ${fullSubtaskId} depends on itself`
						});
						return;
					}

					// A bare number names a sibling subtask, as everywhere else here
					const ref = isSiblingReference(depId)
						? resolveSubtaskDependency(task.id, depId)
						: depId;

					// Check if dependency exists
					if (!exists(ref)) {
						issues.push({
							type: 'missing',
							taskId: fullSubtaskId,
							dependencyId: ref,
							message: `Subtask ${fullSubtaskId} depends on non-existent task/subtask ${depId}`
						});
					}
				});

				// Check for circular dependencies in subtasks
				if (loopMembers.has(fullSubtaskId)) {
					issues.push({
						type: 'circular',
						taskId: fullSubtaskId,
						// fix-dependencies breaks loops made only of subtasks
						fixable: subtaskLoopMembers.has(fullSubtaskId),
						message: `Subtask ${fullSubtaskId} is part of a circular dependency chain`
					});
				}
			});
		}
	});

	// Related and discovered-from links never block, but one to a task that
	// is gone is still stale
	for (const link of findDanglingLinks(tasks, exists)) {
		issues.push({
			type: 'missing-link',
			taskId: link.taskId,
			dependencyId: link.linkedId,
			message: `Task ${link.taskId} links to non-existent task ${link.linkedId}`
		});
	}

	return {
		valid: issues.length === 0,
		issues
	};
}

/**
 * Remove duplicate dependencies from tasks
 * @param {Object} tasksData - Tasks data object with tasks array
 * @returns {Object} Updated tasks data with duplicates removed
 */
function removeDuplicateDependencies(tasksData) {
	const tasks = tasksData.tasks.map((task) => {
		if (!task.dependencies) {
			return task;
		}

		// Convert to Set and back to array to remove duplicates
		const uniqueDeps = [...new Set(task.dependencies)];
		return {
			...task,
			dependencies: uniqueDeps
		};
	});

	return {
		...tasksData,
		tasks
	};
}

/**
 * Clean up invalid subtask dependencies
 * @param {Object} tasksData - Tasks data object with tasks array
 * @returns {Object} Updated tasks data with invalid subtask dependencies removed
 */
function cleanupSubtaskDependencies(tasksData) {
	const tasks = tasksData.tasks.map((task) => {
		// Handle task's own dependencies
		if (task.dependencies) {
			task.dependencies = task.dependencies.filter((depId) => {
				// Keep only dependencies that exist
				return taskExists(tasksData.tasks, depId);
			});
		}

		// Handle subtask dependencies
		if (task.subtasks) {
			task.subtasks = task.subtasks.map((subtask) => {
				if (!subtask.dependencies) {
					return subtask;
				}

				// Filter out dependencies to non-existent subtasks
				subtask.dependencies = subtask.dependencies.filter((depId) => {
					return taskExists(tasksData.tasks, depId);
				});

				return subtask;
			});
		}

		return task;
	});

	return {
		...tasksData,
		tasks
	};
}

/**
 * Check dependencies in the tasks file without changing anything.
 * Prints nothing: the CLI formats the result with `ui.formatDependencyCheck`.
 * @param {string} tasksPath - Path to tasks.json
 * @param {Object} options - Options object, including context
 * @returns {Promise<{valid: boolean, issues: Array, taskCount: number, subtaskCount: number, dependencyCount: number}>}
 */
async function validateDependenciesCommand(tasksPath, options = {}) {
	const { context = {} } = options;
	log('debug', 'Checking for invalid dependencies in task files...');

	const data = readJSON(tasksPath, context.projectRoot, context.tag);
	if (!data || !data.tasks) {
		throw failure(
			DEPENDENCY_ERROR_CODES.NO_TASKS,
			'No tasks yet',
			NO_TASKS_HINT
		);
	}

	const counts = countTasksAndDependencies(data.tasks);
	log(
		'debug',
		`Analyzing dependencies for ${counts.taskCount} tasks and ${counts.subtaskCount} subtasks...`
	);

	const { valid, issues } = validateTaskDependencies(data.tasks);
	// PRD sections with no task, and tasks with no section. Null unless
	// parse-prd recorded sources; gaps are reported but don't fail the check
	const prdCoverage = checkPrdCoverage(
		data.tasks,
		context.projectRoot || process.cwd()
	);
	return { valid, issues, ...counts, prdCoverage };
}

/**
 * How many tasks, subtasks and dependencies there are, for summaries
 * @param {Array} tasks - All tasks
 * @returns {{taskCount: number, subtaskCount: number, dependencyCount: number}}
 */
function countTasksAndDependencies(tasks) {
	const subtaskCount = tasks.reduce(
		(sum, task) =>
			sum + (Array.isArray(task.subtasks) ? task.subtasks.length : 0),
		0
	);
	return {
		taskCount: tasks.length,
		subtaskCount,
		dependencyCount: countAllDependencies(tasks)
	};
}

/**
 * Helper function to count all dependencies across tasks and subtasks
 * @param {Array} tasks - All tasks
 * @returns {number} - Total number of dependencies
 */
function countAllDependencies(tasks) {
	let count = 0;

	tasks.forEach((task) => {
		// Count main task dependencies
		if (task.dependencies && Array.isArray(task.dependencies)) {
			count += task.dependencies.length;
		}

		// Count subtask dependencies
		if (task.subtasks && Array.isArray(task.subtasks)) {
			task.subtasks.forEach((subtask) => {
				if (subtask.dependencies && Array.isArray(subtask.dependencies)) {
					count += subtask.dependencies.length;
				}
			});
		}
	});

	return count;
}

/**
 * Fixes invalid dependencies in tasks.json: removes references to tasks that
 * don't exist, self-dependencies and duplicates, and breaks loops between
 * subtasks. Prints nothing: the CLI formats the result with
 * `ui.formatDependencyFixes`.
 * @param {string} tasksPath - Path to tasks.json
 * @param {Object} options - Options object, including context
 * @returns {Promise<{fixes: Array<{type: string, taskId: number|string, dependencyId?: number|string}>, changed: boolean, taskCount: number, subtaskCount: number, dependencyCount: number}>}
 */
async function fixDependenciesCommand(tasksPath, options = {}) {
	const { context = {} } = options;
	log('debug', 'Checking for and fixing invalid dependencies in tasks.json...');

	// Read tasks data
	const data = readJSON(tasksPath, context.projectRoot, context.tag);
	if (!data || !data.tasks) {
		throw failure(
			DEPENDENCY_ERROR_CODES.NO_TASKS,
			'No tasks yet',
			NO_TASKS_HINT
		);
	}

	try {
		// What was removed, in order, for the summary
		const fixes = [];

		// Create a deep copy of the original data for comparison
		const originalData = JSON.parse(JSON.stringify(data));

		// Track fixes for reporting
		const stats = {
			nonExistentDependenciesRemoved: 0,
			selfDependenciesRemoved: 0,
			duplicateDependenciesRemoved: 0,
			circularDependenciesFixed: 0,
			tasksFixed: 0,
			subtasksFixed: 0
		};

		// First phase: Remove duplicate dependencies in tasks
		data.tasks.forEach((task) => {
			if (task.dependencies && Array.isArray(task.dependencies)) {
				const uniqueDeps = new Set();
				const originalLength = task.dependencies.length;
				task.dependencies = task.dependencies.filter((depId) => {
					const depIdStr = String(depId);
					if (uniqueDeps.has(depIdStr)) {
						fixes.push({
							type: 'duplicate',
							taskId: task.id,
							dependencyId: depId
						});
						stats.duplicateDependenciesRemoved++;
						return false;
					}
					uniqueDeps.add(depIdStr);
					return true;
				});
				if (task.dependencies.length < originalLength) {
					stats.tasksFixed++;
				}
			}

			// Check for duplicates in subtasks
			if (task.subtasks && Array.isArray(task.subtasks)) {
				task.subtasks.forEach((subtask) => {
					if (subtask.dependencies && Array.isArray(subtask.dependencies)) {
						const uniqueDeps = new Set();
						const originalLength = subtask.dependencies.length;
						subtask.dependencies = subtask.dependencies.filter((depId) => {
							const depIdStr = resolveSubtaskDependency(task.id, depId);
							if (uniqueDeps.has(depIdStr)) {
								fixes.push({
									type: 'duplicate',
									taskId: `${task.id}.${subtask.id}`,
									dependencyId: depIdStr
								});
								stats.duplicateDependenciesRemoved++;
								return false;
							}
							uniqueDeps.add(depIdStr);
							return true;
						});
						if (subtask.dependencies.length < originalLength) {
							stats.subtasksFixed++;
						}
					}
				});
			}
		});

		// Create validity maps for tasks and subtasks
		const validTaskIds = new Set(data.tasks.map((t) => t.id));
		const validSubtaskIds = new Set();
		data.tasks.forEach((task) => {
			if (task.subtasks && Array.isArray(task.subtasks)) {
				task.subtasks.forEach((subtask) => {
					validSubtaskIds.add(`${task.id}.${subtask.id}`);
				});
			}
		});

		// Second phase: Remove invalid task dependencies (non-existent tasks)
		data.tasks.forEach((task) => {
			if (task.dependencies && Array.isArray(task.dependencies)) {
				const originalLength = task.dependencies.length;
				task.dependencies = task.dependencies.filter((depId) => {
					// A task can't wait on itself
					if (String(depId) === String(task.id)) {
						fixes.push({ type: 'self', taskId: task.id });
						stats.selfDependenciesRemoved++;
						return false;
					}

					const isSubtask = typeof depId === 'string' && depId.includes('.');

					if (isSubtask) {
						// Check if the subtask exists
						if (!validSubtaskIds.has(depId)) {
							fixes.push({
								type: 'missing',
								taskId: task.id,
								dependencyId: depId
							});
							stats.nonExistentDependenciesRemoved++;
							return false;
						}
						return true;
					} else {
						// Check if the task exists
						const numericId =
							typeof depId === 'string' ? parseInt(depId, 10) : depId;
						if (!validTaskIds.has(numericId)) {
							fixes.push({
								type: 'missing',
								taskId: task.id,
								dependencyId: depId
							});
							stats.nonExistentDependenciesRemoved++;
							return false;
						}
						return true;
					}
				});

				if (task.dependencies.length < originalLength) {
					stats.tasksFixed++;
				}
			}

			// Check subtask dependencies for invalid references
			if (task.subtasks && Array.isArray(task.subtasks)) {
				task.subtasks.forEach((subtask) => {
					if (subtask.dependencies && Array.isArray(subtask.dependencies)) {
						const originalLength = subtask.dependencies.length;
						const subtaskId = `${task.id}.${subtask.id}`;

						// First check for self-dependencies
						const hasSelfDependency = subtask.dependencies.some((depId) => {
							if (typeof depId === 'string' && depId.includes('.')) {
								return depId === subtaskId;
							} else if (isSiblingReference(depId)) {
								return depId === subtask.id;
							}
							return false;
						});

						if (hasSelfDependency) {
							subtask.dependencies = subtask.dependencies.filter((depId) => {
								const normalizedDepId = resolveSubtaskDependency(
									task.id,
									depId
								);

								if (normalizedDepId === subtaskId) {
									fixes.push({ type: 'self', taskId: subtaskId });
									stats.selfDependenciesRemoved++;
									return false;
								}
								return true;
							});
						}

						// Then check for non-existent dependencies
						subtask.dependencies = subtask.dependencies.filter((depId) => {
							if (typeof depId === 'string' && depId.includes('.')) {
								if (!validSubtaskIds.has(depId)) {
									fixes.push({
										type: 'missing',
										taskId: subtaskId,
										dependencyId: depId
									});
									stats.nonExistentDependenciesRemoved++;
									return false;
								}
								return true;
							}

							// Handle numeric dependencies
							const numericId =
								typeof depId === 'number' ? depId : parseInt(depId, 10);

							// A bare number names a sibling subtask; a string like "3"
							// is task 3, the form add-dependency stores
							if (isSiblingReference(depId)) {
								const fullSubtaskId = `${task.id}.${numericId}`;

								if (!validSubtaskIds.has(fullSubtaskId)) {
									fixes.push({
										type: 'missing',
										taskId: subtaskId,
										dependencyId: fullSubtaskId
									});
									stats.nonExistentDependenciesRemoved++;
									return false;
								}

								return true;
							}

							// Otherwise it's a task reference
							if (!validTaskIds.has(numericId)) {
								fixes.push({
									type: 'missing',
									taskId: subtaskId,
									dependencyId: depId
								});
								stats.nonExistentDependenciesRemoved++;
								return false;
							}

							return true;
						});

						if (subtask.dependencies.length < originalLength) {
							stats.subtasksFixed++;
						}
					}
				});
			}
		});

		// Third phase: Check for circular dependencies
		log('debug', 'Checking for circular dependencies...');

		// Build the dependency map for subtasks
		const subtaskDependencyMap = new Map();
		data.tasks.forEach((task) => {
			if (task.subtasks && Array.isArray(task.subtasks)) {
				task.subtasks.forEach((subtask) => {
					const subtaskId = `${task.id}.${subtask.id}`;

					if (subtask.dependencies && Array.isArray(subtask.dependencies)) {
						const normalizedDeps = subtask.dependencies.map((depId) => {
							if (typeof depId === 'string' && depId.includes('.')) {
								return depId;
							}
							return resolveSubtaskDependency(task.id, depId);
						});
						subtaskDependencyMap.set(subtaskId, normalizedDeps);
					} else {
						subtaskDependencyMap.set(subtaskId, []);
					}
				});
			}
		});

		// Break loops between subtasks: drop each dependency that leads back to
		// the subtask it starts from. Removing edges as we go means each loop
		// loses exactly one edge.
		const leadsBackTo = (from, target, seen = new Set()) => {
			if (from === target) return true;
			if (seen.has(from)) return false;
			seen.add(from);
			return (subtaskDependencyMap.get(from) || []).some((next) =>
				leadsBackTo(next, target, seen)
			);
		};

		for (const [subtaskId, dependencies] of subtaskDependencyMap.entries()) {
			const [taskId, subtaskNum] = subtaskId.split('.').map(Number);
			const subtask = data.tasks
				.find((t) => t.id === taskId)
				?.subtasks?.find((st) => st.id === subtaskNum);
			if (!subtask?.dependencies) continue;

			for (const depId of [...dependencies]) {
				if (!leadsBackTo(depId, subtaskId)) continue;

				const originalLength = subtask.dependencies.length;
				subtask.dependencies = subtask.dependencies.filter((dep) => {
					return resolveSubtaskDependency(taskId, dep) !== depId;
				});
				dependencies.splice(dependencies.indexOf(depId), 1);

				if (subtask.dependencies.length < originalLength) {
					fixes.push({
						type: 'circular',
						taskId: subtaskId,
						dependencyId: depId
					});
					stats.circularDependenciesFixed++;
					stats.subtasksFixed++;
				}
			}
		}

		pruneProvenance(data.tasks);

		// Drop related and discovered-from links to tasks that don't exist
		for (const link of pruneTaskLinks(data.tasks)) {
			fixes.push({
				type: 'missing-link',
				taskId: link.taskId,
				dependencyId: link.linkedId
			});
		}

		// Check if any changes were made by comparing with original data
		const dataChanged = JSON.stringify(data) !== JSON.stringify(originalData);

		if (dataChanged) {
			writeJSON(tasksPath, data, context.projectRoot, context.tag);
			log('debug', `Fixed ${fixes.length} dependency problems`, stats);
		} else {
			log('debug', 'No changes needed to fix dependencies');
		}

		return {
			fixes,
			// Loops between tasks are left for the user to break
			remaining: validateTaskDependencies(data.tasks).issues,
			changed: dataChanged,
			...countTasksAndDependencies(data.tasks)
		};
	} catch (error) {
		throw failure(
			DEPENDENCY_ERROR_CODES.FIX_FAILED,
			`Couldn't fix dependencies: ${error.message}`,
			undefined,
			error
		);
	}
}

/**
 * Ensure at least one subtask in each task has no dependencies
 * @param {Object} tasksData - The tasks data object with tasks array
 * @returns {boolean} - True if any changes were made
 */
function ensureAtLeastOneIndependentSubtask(tasksData) {
	if (!tasksData || !tasksData.tasks || !Array.isArray(tasksData.tasks)) {
		return false;
	}

	let changesDetected = false;

	tasksData.tasks.forEach((task) => {
		if (
			!task.subtasks ||
			!Array.isArray(task.subtasks) ||
			task.subtasks.length === 0
		) {
			return;
		}

		// Check if any subtask has no dependencies
		const hasIndependentSubtask = task.subtasks.some(
			(st) =>
				!st.dependencies ||
				!Array.isArray(st.dependencies) ||
				st.dependencies.length === 0
		);

		if (!hasIndependentSubtask) {
			// Find the first subtask and clear its dependencies
			if (task.subtasks.length > 0) {
				const firstSubtask = task.subtasks[0];
				log(
					'debug',
					`Ensuring at least one independent subtask: Clearing dependencies for subtask ${task.id}.${firstSubtask.id}`
				);
				firstSubtask.dependencies = [];
				changesDetected = true;
			}
		}
	});

	return changesDetected;
}

/**
 * Validate and fix dependencies across all tasks and subtasks
 * This function is designed to be called after any task modification
 * @param {Object} tasksData - The tasks data object with tasks array
 * @param {string} tasksPath - Optional path to save the changes
 * @param {string} projectRoot - Optional project root for tag context
 * @param {string} tag - Optional tag for tag context
 * @returns {boolean} - True if any changes were made
 */
function validateAndFixDependencies(
	tasksData,
	tasksPath = null,
	projectRoot = null,
	tag = null
) {
	if (!tasksData || !tasksData.tasks || !Array.isArray(tasksData.tasks)) {
		log('error', 'Invalid tasks data');
		return false;
	}

	log('debug', 'Validating and fixing dependencies...');

	// Create a deep copy for comparison
	const originalData = JSON.parse(JSON.stringify(tasksData));

	// 1. Remove duplicate dependencies from tasks and subtasks
	tasksData.tasks = tasksData.tasks.map((task) => {
		// Handle task dependencies
		if (task.dependencies) {
			const uniqueDeps = [...new Set(task.dependencies)];
			task.dependencies = uniqueDeps;
		}

		// Handle subtask dependencies
		if (task.subtasks) {
			task.subtasks = task.subtasks.map((subtask) => {
				if (subtask.dependencies) {
					const uniqueDeps = [...new Set(subtask.dependencies)];
					subtask.dependencies = uniqueDeps;
				}
				return subtask;
			});
		}
		return task;
	});

	// 2. Remove invalid task dependencies (non-existent tasks)
	tasksData.tasks.forEach((task) => {
		// Clean up task dependencies
		if (task.dependencies) {
			task.dependencies = task.dependencies.filter((depId) => {
				// Remove self-dependencies
				if (String(depId) === String(task.id)) {
					return false;
				}
				// Remove non-existent dependencies
				return taskExists(tasksData.tasks, depId);
			});
		}

		// Clean up subtask dependencies
		if (task.subtasks) {
			task.subtasks.forEach((subtask) => {
				if (subtask.dependencies) {
					subtask.dependencies = subtask.dependencies.filter((depId) => {
						// Handle numeric subtask references
						if (isSiblingReference(depId)) {
							const fullSubtaskId = resolveSubtaskDependency(task.id, depId);
							return taskExists(tasksData.tasks, fullSubtaskId);
						}
						// Handle full task/subtask references
						return taskExists(tasksData.tasks, depId);
					});
				}
			});
		}
	});

	// 3. Ensure at least one subtask has no dependencies in each task
	tasksData.tasks.forEach((task) => {
		if (task.subtasks && task.subtasks.length > 0) {
			const hasIndependentSubtask = task.subtasks.some(
				(st) =>
					!st.dependencies ||
					!Array.isArray(st.dependencies) ||
					st.dependencies.length === 0
			);

			if (!hasIndependentSubtask) {
				task.subtasks[0].dependencies = [];
			}
		}
	});

	pruneProvenance(tasksData.tasks);

	// Check if any changes were made by comparing with original data
	const changesDetected =
		JSON.stringify(tasksData) !== JSON.stringify(originalData);

	// Save changes if needed
	if (tasksPath && changesDetected) {
		try {
			writeJSON(tasksPath, tasksData, projectRoot, tag);
			log('debug', 'Saved dependency fixes to tasks.json');
		} catch (error) {
			log('error', 'Failed to save dependency fixes to tasks.json', error);
		}
	}

	return changesDetected;
}

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
	addDependency,
	canMoveWithDependencies,
	cleanupSubtaskDependencies,
	DEPENDENCY_ERROR_CODES,
	DependencyError,
	ensureAtLeastOneIndependentSubtask,
	findAllDependenciesRecursively,
	findCrossTagDependencies,
	buildDependencyGraph,
	createTaskLookup,
	findDependencyTask,
	findLoopMembers,
	findTaskCrossTagConflicts,
	fixDependenciesCommand,
	getDependentTaskIds,
	isCircularDependency,
	removeDependency,
	removeDuplicateDependencies,
	validateAndFixDependencies,
	validateCrossTagMove,
	validateDependenciesCommand,
	validateSubtaskMove,
	validateTaskDependencies
};
