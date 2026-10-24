/**
 * @fileoverview TaskRemovalService: remove-task, remove-subtask and
 * clear-subtasks on a tag's tasks.json, each in one locked read-modify-write.
 * The rules are in utils/task-removal.ts; this applies them to storage.
 */

import fs from 'node:fs';
import path from 'node:path';
import { TASKGRAPH_TASKS_FILE } from '../../../common/constants/paths.js';
import type { Task } from '../../../common/types/index.js';
import { readArchivedIdsSync } from '../utils/archive.js';
import {
	type ClearSubtasksResult,
	clearSubtasksIn,
	previewTaskRemoval,
	type RemoveTasksOutcome,
	removeSubtasksIn,
	removeTasksIn,
	splitIds,
	type TaskRemovalPreview
} from '../utils/task-removal.js';
import type { TaskService } from './task-service.js';

export interface RemoveTasksResult
	extends Omit<RemoveTasksOutcome, 'removedTaskNumbers' | 'messages'> {
	/** One line per removed ID and deleted task file */
	messages: string[];
	/** Task files that couldn't be deleted; tasks.json was saved */
	errors: string[];
	tag: string;
	tasksPath: string;
}

export class TaskRemovalService {
	constructor(
		private readonly taskService: TaskService,
		private readonly projectRoot: string
	) {}

	/** What removeTasks would remove, without changing anything */
	async preview(
		ids: string,
		options: { tag?: string } = {}
	): Promise<TaskRemovalPreview & { tag: string }> {
		const { tasks, tag } = await this.taskService.loadStoredTasks(options.tag);
		return { ...previewTaskRemoval(tasks, splitIds(ids)), tag };
	}

	/**
	 * Remove tasks and subtasks ("5,6.1"), with their task files. Throws,
	 * changing nothing, when an ID names nothing.
	 */
	async removeTasks(
		ids: string,
		options: { tag?: string } = {}
	): Promise<RemoveTasksResult> {
		const tag = this.tagFor(options.tag);
		const { result } = await this.taskService.modifyTasks(
			(tasks, archivedIds) => ({
				tasks,
				result: removeTasksIn(tasks, splitIds(ids), tag, archivedIds)
			}),
			tag
		);
		const { removedTaskNumbers, ...outcome } = result;
		const errors: string[] = [];
		const tasksPath = this.tasksPath();
		// After tasks.json is saved, so a failure here loses no task
		for (const number of removedTaskNumbers) {
			const file = path.join(
				path.dirname(tasksPath),
				`task_${String(number).padStart(3, '0')}.txt`
			);
			if (!fs.existsSync(file)) continue;
			try {
				fs.unlinkSync(file);
				outcome.messages.push(`Deleted task file: ${file}`);
			} catch (error) {
				errors.push(
					`Failed to delete task file ${file}: ${(error as Error).message}`
				);
			}
		}
		return { ...outcome, errors, tag, tasksPath };
	}

	/**
	 * Remove subtasks ("5.2"), or with `convert` turn each into a task.
	 * Throws, changing nothing, when an ID isn't a subtask that exists.
	 * @returns For each ID, the task it became, or null
	 */
	async removeSubtasks(
		ids: string[],
		options: { tag?: string; convert?: boolean } = {}
	): Promise<{ converted: Array<Task | null>; tag: string }> {
		const tag = this.tagFor(options.tag);
		const { result } = await this.taskService.modifyTasks(
			(tasks, archivedIds) => ({
				tasks,
				result: removeSubtasksIn(tasks, ids, {
					convert: options.convert,
					archivedIds,
					highestArchivedId: options.convert
						? readArchivedIdsSync(this.tasksPath(), tag).highestId
						: 0
				})
			}),
			tag
		);
		return { converted: result, tag };
	}

	/**
	 * Remove every subtask of the given tasks ("3,5", or "all"). Throws,
	 * changing nothing, for an ID that isn't a task.
	 */
	async clearSubtasks(
		ids: string,
		options: { tag?: string } = {}
	): Promise<ClearSubtasksResult & { tag: string }> {
		const { result, tag } = await this.taskService.modifyTasks((tasks) => {
			const cleared = clearSubtasksIn(tasks, ids);
			return {
				tasks: cleared.cleared.length > 0 ? tasks : null,
				result: cleared
			};
		}, options.tag);
		return { ...result, tag };
	}

	/** The tag a command works in; modifyTasks refuses one that doesn't exist */
	private tagFor(tag?: string): string {
		return tag || this.taskService.getActiveTag();
	}

	private tasksPath(): string {
		return path.join(this.projectRoot, TASKGRAPH_TASKS_FILE);
	}
}
