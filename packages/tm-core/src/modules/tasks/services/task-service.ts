/**
 * @fileoverview Task Service
 * Core service for task operations - handles business logic between storage and API.
 * The reads live in TaskReader (task-reader.ts); this file adds the writes.
 */

import type { Subtask, Task, TaskStatus } from '../../../common/types/index.js';
import type {
	ArchiveTasksOptions,
	TaskFieldUpdates,
	UpdateStatusOptions
} from '../../../common/interfaces/storage.interface.js';
import { type TaskClaim, resolveClaimant } from '../utils/claim.js';
import { normalizeTaskIds } from '../utils/task-ids.js';
import { appendNote } from '../utils/notes.js';
import { TASK_STATUSES } from '../../../common/constants/index.js';
import {
	ERROR_CODES,
	TaskGraphError
} from '../../../common/errors/taskgraph-error.js';
import { TaskReader } from './task-reader.js';

export type { GetTaskListOptions, TaskListResult } from './task-reader.js';

/**
 * TaskService handles all task-related operations
 * This is where business logic lives - it coordinates between ConfigManager and Storage
 */
export class TaskService extends TaskReader {
	/**
	 * Move done and cancelled tasks last changed at least `olderThanDays`
	 * ago into the archive, in one locked write
	 * @returns The tasks archived (or that would be, with dryRun), with
	 * string IDs (see normalizeTaskIds)
	 */
	async archiveTasks(
		options: ArchiveTasksOptions,
		tag?: string
	): Promise<Task[]> {
		const tasks = await this.storage.archiveTasks(
			options,
			tag || this.getActiveTag()
		);
		return tasks.map(normalizeTaskIds);
	}

	/**
	 * Move one archived task back into tasks.json. IDs come back as strings
	 * (see normalizeTaskIds)
	 */
	async restoreArchivedTask(taskId: string, tag?: string): Promise<Task> {
		const task = await this.storage.restoreArchivedTask(
			taskId,
			tag || this.getActiveTag()
		);
		return normalizeTaskIds(task);
	}

	/**
	 * Pick the next task nobody has started and set it in-progress in one
	 * locked write, so two sessions claiming at once get different tasks
	 * @param tag - Tag to claim from; the active tag when omitted
	 * @param claimant - Recorded as `metadata.claimedBy`; the session ID or user
	 *   name when omitted (see resolveClaimant)
	 * @param among - Only these top-level task IDs (one parallel wave, say)
	 * @returns The claim, or null when no task is ready
	 */
	async claimNextTask(
		tag?: string,
		claimant?: string,
		among?: ReadonlySet<string>
	): Promise<TaskClaim | null> {
		if (!this.storage) {
			throw new TaskGraphError(
				'Storage not initialized',
				ERROR_CODES.STORAGE_ERROR
			);
		}
		const activeTag = await this.resolveTag(tag);
		return this.storage.claimNextTask(
			claimant?.trim() || resolveClaimant(),
			activeTag,
			among
		);
	}

	/**
	 * Set active tag
	 */
	async setActiveTag(tag: string): Promise<void> {
		await this.configManager.setActiveTag(tag);
	}

	/**
	 * Update a task with new data (direct structural update)
	 * @param taskId - Task ID (supports numeric, alphanumeric, and subtask IDs)
	 * @param updates - Partial task object with fields to update
	 * @param tag - Optional tag context
	 */
	async updateTask(
		taskId: string | number,
		updates: Partial<Task>,
		tag?: string
	): Promise<void> {
		// Ensure we have storage
		if (!this.storage) {
			throw new TaskGraphError(
				'Storage not initialized',
				ERROR_CODES.STORAGE_ERROR
			);
		}

		// Auto-initialize if needed
		if (!this.initialized) {
			await this.initialize();
		}

		const activeTag = await this.resolveTag(tag);
		const taskIdStr = String(taskId);

		try {
			// Direct update - no AI processing
			await this.storage.updateTask(taskIdStr, updates, activeTag);
		} catch (error) {
			// Re-throw all TaskGraphErrors without wrapping
			if (error instanceof TaskGraphError) {
				throw error;
			}

			throw new TaskGraphError(
				`Failed to update task ${taskId}`,
				ERROR_CODES.STORAGE_ERROR,
				{
					operation: 'updateTask',
					resource: 'task',
					taskId: taskIdStr,
					tag: activeTag
				},
				error as Error
			);
		}
	}

	/**
	 * Change one task or subtask in a single locked read-modify-write
	 */
	async modifyTask(
		taskId: string,
		change: (task: Task | Subtask, isSubtask: boolean) => TaskFieldUpdates,
		tag?: string
	): Promise<Task | Subtask> {
		if (!this.storage) {
			throw new TaskGraphError(
				'Storage not initialized',
				ERROR_CODES.STORAGE_ERROR
			);
		}
		if (!this.initialized) {
			await this.initialize();
		}
		return this.storage.modifyTask(
			String(taskId),
			change,
			await this.resolveTag(tag)
		);
	}

	/**
	 * Append text to a task or subtask's details as a timestamped
	 * `<info added on …>` block, in one locked write that changes only that
	 * item: `note`, research's save to a task, update-subtask's append.
	 * The text is saved as given. `alsoChange` returns other fields to save
	 * in the same write.
	 * @returns The item as saved and the block's ISO time
	 */
	async appendToDetails(
		taskId: string,
		text: string,
		tag?: string,
		alsoChange?: (task: Task | Subtask) => TaskFieldUpdates
	): Promise<{ saved: Task | Subtask; addedAt: string }> {
		const addedAt = new Date().toISOString();
		const saved = await this.modifyTask(
			taskId,
			(task) => ({
				...alsoChange?.(task),
				details: appendNote(task.details, text, addedAt)
			}),
			tag
		);
		return { saved, addedAt };
	}

	/**
	 * Change a tag's tasks, as stored, in one locked write: `change` returns
	 * the tasks to save (null saves nothing) and a result. It also gets the
	 * tag's archived task IDs.
	 * @returns The change's result and the tag it ran on
	 */
	async modifyTasks<R>(
		change: (
			tasks: Task[],
			archivedIds: ReadonlySet<string>
		) => { tasks: Task[] | null; result: R },
		tag?: string
	): Promise<{ result: R; tag: string }> {
		if (!this.storage) {
			throw new TaskGraphError(
				'Storage not initialized',
				ERROR_CODES.STORAGE_ERROR
			);
		}
		if (!this.initialized) {
			await this.initialize();
		}
		const resolvedTag = await this.resolveTag(tag);
		const archivedIds = await this.storage.loadArchivedTaskIds(resolvedTag);
		if (!(await this.tagInFile(resolvedTag))) {
			// Never written: storage reads a missing master as the first tag, and
			// saving that would copy it
			return { result: change([], archivedIds).result, tag: resolvedTag };
		}
		const result = await this.storage.mutateTags((tags) => {
			const { tasks, result } = change(
				tags.get(resolvedTag) ?? [],
				archivedIds
			);
			if (tasks) tags.set(resolvedTag, tasks);
			return { changed: tasks ? [resolvedTag] : [], result };
		});
		return { result, tag: resolvedTag };
	}

	/**
	 * Update task status - delegates to storage layer which handles storage-specific logic
	 */
	async updateTaskStatus(
		taskId: string | number,
		newStatus: TaskStatus,
		tag?: string,
		options?: UpdateStatusOptions
	): Promise<{
		success: boolean;
		oldStatus: TaskStatus;
		newStatus: TaskStatus;
		taskId: string;
	}> {
		// TaskStatus is compile-time only; MCP, GitHub sync and JS callers pass raw strings
		if (!TASK_STATUSES.includes(newStatus)) {
			throw new TaskGraphError(
				// JSON.stringify escapes control characters a raw string could carry
				`${JSON.stringify(newStatus)} isn't a status. Use one of: ${TASK_STATUSES.join(', ')}`,
				ERROR_CODES.VALIDATION_ERROR,
				{ taskId: String(taskId), newStatus }
			);
		}

		// Ensure we have storage
		if (!this.storage) {
			throw new TaskGraphError(
				'Storage not initialized',
				ERROR_CODES.STORAGE_ERROR
			);
		}

		const activeTag = await this.resolveTag(tag);
		const taskIdStr = String(taskId);

		try {
			// Delegate to storage layer which handles the specific logic for tasks vs subtasks
			return await this.storage.updateTaskStatus(
				taskIdStr,
				newStatus,
				activeTag,
				options
			);
		} catch (error) {
			// Re-throw all TaskGraphErrors without wrapping
			if (error instanceof TaskGraphError) {
				throw error;
			}

			throw new TaskGraphError(
				`Failed to update task status for ${taskIdStr}`,
				ERROR_CODES.STORAGE_ERROR,
				{
					operation: 'updateTaskStatus',
					resource: 'task',
					taskId: taskIdStr,
					newStatus,
					tag: activeTag
				},
				error as Error
			);
		}
	}
}
