import {
	assignMetadata,
	dependenciesForMovedItem,
	dropReferences,
	liveOrArchived,
	nextTaskId,
	promotedSubtaskDescription,
	pruneTaskLinks,
	readArchivedIdsSync,
	retargetDependents
} from '@tm/core';
import { log, readJSON, writeJSON } from '../utils.js';

/**
 * Remove one or more subtasks from their parent tasks. The file is saved once,
 * after every ID was found, so a list with a missing subtask changes nothing.
 * @param {string} tasksPath - Path to the tasks.json file
 * @param {string|string[]} subtaskIds - Subtask ID ("parentId.subtaskId"), or a list of them
 * @param {boolean} convertToTask - Whether to convert the subtask to a standalone task
 * @param {boolean} generateFiles - Whether to regenerate task files after removing the subtask
 * @param {Object} context - Context object containing projectRoot and tag information
 * @param {string} [context.projectRoot] - Project root path
 * @param {string} [context.tag] - Tag for the task
 * @returns {Object|null|Array<Object|null>} The converted task if convertToTask is true, otherwise null; a list of them when subtaskIds is a list
 */
async function removeSubtask(
	tasksPath,
	subtaskIds,
	convertToTask = false,
	generateFiles = false,
	context = {}
) {
	const { projectRoot, tag } = context;
	const ids = Array.isArray(subtaskIds) ? subtaskIds : [subtaskIds];
	try {
		log('debug', `Removing subtask(s) ${ids.join(', ')}...`);

		// Read the existing tasks with proper context
		const data = readJSON(tasksPath, projectRoot, tag);
		if (!data || !data.tasks) {
			throw new Error(`Invalid or missing tasks file at ${tasksPath}`);
		}

		// Removes in memory; a missing ID throws before anything is saved
		const convertedTasks = ids.map((subtaskId) =>
			removeFromData(data, subtaskId, convertToTask, tasksPath, tag)
		);

		// Write the updated tasks back to the file with proper context
		writeJSON(tasksPath, data, projectRoot, tag);

		// Note: Task file generation is no longer supported and has been removed

		return Array.isArray(subtaskIds) ? convertedTasks : convertedTasks[0];
	} catch (error) {
		// The command prints the thrown error; keep this out of the terminal
		log('debug', `Error removing subtask: ${error.message}`);
		throw error;
	}
}

// Removes one subtask from data in memory
function removeFromData(data, subtaskId, convertToTask, tasksPath, tag) {
	if (!subtaskId.includes('.')) {
		throw new Error(
			`Invalid subtask ID format: ${subtaskId}. Expected format: "parentId.subtaskId"`
		);
	}
	const [parentIdStr, subtaskIdStr] = subtaskId.split('.');
	const parentId = parseInt(parentIdStr, 10);
	const subtaskIdNum = parseInt(subtaskIdStr, 10);
	const parentTask = data.tasks.find((t) => String(t.id) === String(parentId));
	if (!parentTask) {
		throw new Error(
			`Task ${parentId} not found, so subtask ${subtaskId} doesn't exist`
		);
	}
	const subtaskIndex = (parentTask.subtasks ?? []).findIndex(
		(st) => String(st.id) === String(subtaskIdNum)
	);
	if (subtaskIndex === -1) {
		throw new Error(`Subtask ${subtaskId} not found`);
	}

	// Get a copy of the subtask before removing it
	const removedSubtask = { ...parentTask.subtasks[subtaskIndex] };

	// Remove the subtask from the parent
	parentTask.subtasks.splice(subtaskIndex, 1);

	// If parent has no more subtasks, remove the subtasks array
	if (parentTask.subtasks.length === 0) {
		parentTask.subtasks = undefined;
	}

	let convertedTask = null;

	// Convert the subtask to a standalone task if requested
	if (convertToTask) {
		log('debug', `Converting subtask ${subtaskId} to a standalone task...`);

		// The next free ID, above every archived ID too
		const newTaskId = nextTaskId(
			data.tasks.map((t) => t.id),
			readArchivedIdsSync(tasksPath, data.tag || tag || 'master').highestId
		);

		// Its siblings become full IDs, which read the same on a task
		const moved = dependenciesForMovedItem(removedSubtask, parentId, undefined);

		// Create the new task from the subtask
		convertedTask = {
			id: newTaskId,
			title: removedSubtask.title,
			description: promotedSubtaskDescription(removedSubtask),
			details: removedSubtask.details || '',
			status: removedSubtask.status || 'pending',
			dependencies: moved.dependencies,
			priority: parentTask.priority || 'medium' // Inherit priority from parent
		};

		// Keep metadata (and its dependency marks, re-keyed for top level)
		assignMetadata(convertedTask, moved.metadata);

		// Add the parent task as a dependency if not already present
		if (!convertedTask.dependencies.includes(String(parentId))) {
			convertedTask.dependencies.push(String(parentId));
		}

		// Whatever depended on the subtask now depends on the task
		retargetDependents(data.tasks, `${parentId}.${subtaskIdNum}`, newTaskId);

		// Add the converted task to the tasks array
		data.tasks.push(convertedTask);

		log('debug', `Created new task ${newTaskId} from subtask ${subtaskId}`);
	} else {
		// Dependencies on it, their marks and links to it go with it
		dropReferences(data.tasks, [`${parentId}.${subtaskIdNum}`]);
		pruneTaskLinks(
			data.tasks,
			liveOrArchived(
				data.tasks,
				() => readArchivedIdsSync(tasksPath, data.tag || tag || 'master').ids
			)
		);
		log('debug', `Subtask ${subtaskId} deleted`);
	}

	return convertedTask;
}

export default removeSubtask;
