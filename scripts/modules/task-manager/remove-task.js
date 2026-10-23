import {
	dropReferences,
	getOwnKey,
	liveOrArchived,
	pruneTaskLinks,
	readArchivedIdsSync
} from '@tm/core';
import * as fs from 'fs';
import path from 'path';
import { findTaskById, log, readJSON } from '../utils.js';
import { updateTagTasks } from '../utils/update-tag-tasks.js';
import taskExists from './task-exists.js';

/**
 * Removes one or more tasks or subtasks from the tasks file
 * @param {string} tasksPath - Path to the tasks file
 * @param {string} taskIds - Comma-separated string of task/subtask IDs to remove (e.g., '5,6.1,7')
 * @param {Object} context - Context object containing projectRoot and tag information
 * @param {string} [context.projectRoot] - Project root path
 * @param {string} [context.tag] - Tag for the task
 * @returns {Object} Result object with success status, messages, and removed task info
 */
async function removeTask(tasksPath, taskIds, context = {}) {
	const { projectRoot, tag } = context;
	const results = {
		success: true,
		messages: [],
		errors: [],
		removedTasks: []
	};
	const taskIdsToRemove = taskIds
		.split(',')
		.map((id) => id.trim())
		.filter(Boolean); // Remove empty strings if any

	if (taskIdsToRemove.length === 0) {
		results.success = false;
		results.errors.push('No valid task IDs provided.');
		return results;
	}

	try {
		// Read the tasks file ONCE before the loop, preserving the full tagged structure
		const rawData = readJSON(tasksPath, projectRoot, tag); // Read raw data
		if (!rawData) {
			throw new Error(`Could not read tasks file at ${tasksPath}`);
		}

		// Use the full tagged data if available, otherwise use the data as is
		const fullTaggedData = rawData._rawTaggedData || rawData;

		if (!getOwnKey(fullTaggedData, tag)?.tasks) {
			throw new Error(`Tag '${tag}' not found or has no tasks.`);
		}

		const tasksToDeleteFiles = []; // Collect IDs of main tasks whose files should be deleted

		// Remove from the tag as it is in the file now. It may have changed since
		// it was read above, so the IDs are looked up again here.
		await updateTagTasks(tasksPath, tag, (tagData) => {
			const tasks = tagData.tasks;
			for (const taskId of taskIdsToRemove) {
				// Check if the task ID exists *before* attempting removal
				if (!taskExists(tasks, taskId)) {
					const errorMsg = `Task with ID ${taskId} in tag '${tag}' not found or already removed.`;
					results.errors.push(errorMsg);
					results.success = false; // Mark overall success as false if any error occurs
					continue; // Skip to the next ID
				}

				try {
					// Handle subtask removal (e.g., '5.2')
					if (typeof taskId === 'string' && taskId.includes('.')) {
						const [parentTaskId, subtaskId] = taskId
							.split('.')
							.map((id) => parseInt(id, 10));

						// Find the parent task
						const parentTask = tasks.find((t) => t.id === parentTaskId);
						if (!parentTask || !parentTask.subtasks) {
							throw new Error(
								`Parent task ${parentTaskId} or its subtasks not found for subtask ${taskId}`
							);
						}

						// Find the subtask to remove
						const subtaskIndex = parentTask.subtasks.findIndex(
							(st) => st.id === subtaskId
						);
						if (subtaskIndex === -1) {
							throw new Error(
								`Subtask ${subtaskId} not found in parent task ${parentTaskId}`
							);
						}

						// Store the subtask info before removal
						const removedSubtask = {
							...parentTask.subtasks[subtaskIndex],
							parentTaskId: parentTaskId
						};
						results.removedTasks.push(removedSubtask);

						// Remove the subtask from the parent
						parentTask.subtasks.splice(subtaskIndex, 1);

						results.messages.push(
							`Successfully removed subtask ${taskId} from tag '${tag}'`
						);
					}
					// Handle main task removal
					else {
						const taskIdNum = parseInt(taskId, 10);
						const taskIndex = tasks.findIndex((t) => t.id === taskIdNum);
						if (taskIndex === -1) {
							throw new Error(
								`Task with ID ${taskId} not found in tag '${tag}'`
							);
						}

						// Store the task info before removal
						const removedTask = tasks[taskIndex];
						results.removedTasks.push(removedTask);
						tasksToDeleteFiles.push(taskIdNum); // Add to list for file deletion

						// Remove the task from the main array
						tasks.splice(taskIndex, 1);

						results.messages.push(
							`Successfully removed task ${taskId} from tag '${tag}'`
						);
					}
				} catch (innerError) {
					// Catch errors specific to processing *this* ID
					const errorMsg = `Error processing ID ${taskId}: ${innerError.message}`;
					results.errors.push(errorMsg);
					results.success = false;
					log('warn', errorMsg); // Log as warning and continue with next ID
				}
			} // End of loop through taskIdsToRemove

			if (results.removedTasks.length > 0) {
				const allRemovedIds = new Set(
					taskIdsToRemove.map((id) =>
						typeof id === 'string' && id.includes('.')
							? id
							: String(parseInt(id, 10))
					)
				);

				// Dependency IDs name tasks of the same tag, so only this tag changes
				dropReferences(tasks, allRemovedIds);
				// Related and discovered-from links to the subtasks of a removed
				// task go too
				pruneTaskLinks(
					tasks,
					liveOrArchived(tasks, () => readArchivedIdsSync(tasksPath, tag).ids)
				);
			}
		});

		if (results.removedTasks.length > 0) {
			// Delete task files AFTER saving tasks.json
			for (const taskIdNum of tasksToDeleteFiles) {
				const taskFileName = path.join(
					path.dirname(tasksPath),
					`task_${taskIdNum.toString().padStart(3, '0')}.txt`
				);
				if (fs.existsSync(taskFileName)) {
					try {
						fs.unlinkSync(taskFileName);
						results.messages.push(`Deleted task file: ${taskFileName}`);
					} catch (unlinkError) {
						const unlinkMsg = `Failed to delete task file ${taskFileName}: ${unlinkError.message}`;
						results.errors.push(unlinkMsg);
						results.success = false;
						log('warn', unlinkMsg);
					}
				}
			}

			// Generate updated task files ONCE, with context
			// try {
			// 	await generateTaskFiles(tasksPath, path.dirname(tasksPath), {
			// 		projectRoot,
			// 		tag
			// 	});
			// 	results.messages.push('Task files regenerated successfully.');
			// } catch (genError) {
			// 	const genErrMsg = `Failed to regenerate task files: ${genError.message}`;
			// 	results.errors.push(genErrMsg);
			// 	results.success = false;
			// 	log('warn', genErrMsg);
			// }
		} else if (results.errors.length === 0) {
			results.messages.push('No tasks found matching the provided IDs.');
		}

		// Consolidate messages for final output
		const finalMessage = results.messages.join('\n');
		const finalError = results.errors.join('\n');

		return {
			success: results.success,
			message: finalMessage || 'No tasks were removed.',
			error: finalError || null,
			removedTasks: results.removedTasks
		};
	} catch (error) {
		// Catch errors from reading file or other initial setup
		log('error', `Error removing tasks: ${error.message}`);
		return {
			success: false,
			message: '',
			error: `Operation failed: ${error.message}`,
			removedTasks: []
		};
	}
}

export default removeTask;
