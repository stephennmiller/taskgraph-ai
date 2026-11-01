/**
 * @fileoverview Format handler for task storage files
 */

import {
	ERROR_CODES,
	TaskGraphError
} from '../../../../common/errors/taskgraph-error.js';
import { isStoredTaskId } from '../../../../common/schemas/index.js';
import type { Task, TaskMetadata } from '../../../../common/types/index.js';
import { normalizeTaskStatuses } from '../../../tasks/utils/legacy-status.js';
import { STORED_TAG_PATTERN } from '../../../tasks/utils/tag-names.js';
import { isTagObject } from './schema-version.js';
import { buildTagMetadata } from './tag-update.js';

export interface FileStorageData {
	tasks: Task[];
	metadata: TaskMetadata;
}

export type FileFormat = 'legacy' | 'standard';

/**
 * Whether a top-level key of tasks.json is a tag. `tasks` and `metadata` are
 * the untagged file's fields unless they hold a tag, which versions before
 * #802 could create
 */
function isTagKey(data: any, key: string): boolean {
	return (key !== 'tasks' && key !== 'metadata') || isTagObject(data[key]);
}

/**
 * The tags to show or fall back to. A key that isn't safe to print stays in
 * the file but is never listed.
 */
function listableTags(data: any): string[] {
	return Object.keys(data).filter(
		(key) => isTagKey(data, key) && STORED_TAG_PATTERN.test(key)
	);
}

/**
 * Refuse a file whose task or subtask IDs aren't numbers: commands put them in
 * command text outside any data fence. Dropping the task instead would lose
 * it on the next save. The message says where, not what, because the
 * session-start hook hands error text to the agent.
 * @throws {TaskGraphError} VALIDATION_ERROR
 */
function assertStoredIds(tasks: Task[]): void {
	tasks.forEach((task, index) => {
		const ids = [task, ...(task.subtasks ?? [])].map((item) => item.id);
		if (!ids.every(isStoredTaskId)) {
			throw new TaskGraphError(
				`tasks.json: task ${index + 1} of ${tasks.length} in this tag has an ID that isn't a number`,
				ERROR_CODES.VALIDATION_ERROR
			);
		}
	});
}

/**
 * Handles format detection and conversion between legacy and standard task file formats
 */
export class FormatHandler {
	/**
	 * Detect the format of the raw data
	 */
	detectFormat(data: any): FileFormat {
		if (!data || typeof data !== 'object') {
			return 'standard';
		}

		// Tagged ('legacy') when any top-level key is a tag
		return Object.keys(data).some((key) => isTagKey(data, key))
			? 'legacy'
			: 'standard';
	}

	/**
	 * Extract tasks from data for a specific tag. The older 'completed'
	 * status reads as 'done', so the next save writes 'done' back.
	 */
	extractTasks(data: any, tag: string): Task[] {
		if (!data) {
			return [];
		}

		const format = this.detectFormat(data);
		const tasks =
			format === 'legacy'
				? this.extractTasksFromLegacy(data, tag)
				: this.extractTasksFromStandard(data);

		if (!Array.isArray(tasks)) return tasks;
		assertStoredIds(tasks);
		return normalizeTaskStatuses(tasks);
	}

	/**
	 * Extract tasks from legacy format
	 */
	private extractTasksFromLegacy(data: any, tag: string): Task[] {
		// First check if the requested tag exists
		if (Object.hasOwn(data, tag)) {
			const tagData = data[tag];
			return tagData?.tasks || [];
		}

		// If we're looking for 'master' tag but it doesn't exist, try the first available tag
		const availableKeys = listableTags(data);
		if (tag === 'master' && availableKeys.length > 0) {
			const firstTag = availableKeys[0];
			const tagData = data[firstTag];
			return tagData?.tasks || [];
		}

		return [];
	}

	/**
	 * Extract tasks from standard format
	 */
	private extractTasksFromStandard(data: any): Task[] {
		return data?.tasks || [];
	}

	/**
	 * Extract metadata from data for a specific tag
	 */
	extractMetadata(data: any, tag: string): TaskMetadata | null {
		if (!data) {
			return null;
		}

		const format = this.detectFormat(data);

		if (format === 'legacy') {
			return this.extractMetadataFromLegacy(data, tag);
		}

		return this.extractMetadataFromStandard(data);
	}

	/**
	 * Extract metadata from legacy format
	 */
	private extractMetadataFromLegacy(
		data: any,
		tag: string
	): TaskMetadata | null {
		if (Object.hasOwn(data, tag)) {
			const tagData = data[tag];
			// Generate metadata if not present in legacy format
			if (!tagData?.metadata && tagData?.tasks) {
				return this.generateMetadataFromTasks(tagData.tasks, tag);
			}
			return tagData?.metadata || null;
		}

		// If we're looking for 'master' tag but it doesn't exist, try the first available tag
		const availableKeys = listableTags(data);
		if (tag === 'master' && availableKeys.length > 0) {
			const firstTag = availableKeys[0];
			const tagData = data[firstTag];
			if (!tagData?.metadata && tagData?.tasks) {
				return this.generateMetadataFromTasks(tagData.tasks, firstTag);
			}
			return tagData?.metadata || null;
		}

		return null;
	}

	/**
	 * Extract metadata from standard format
	 */
	private extractMetadataFromStandard(data: any): TaskMetadata | null {
		return data?.metadata || null;
	}

	/**
	 * Extract all available tags from the single tasks.json file
	 */
	extractTags(data: any): string[] {
		if (!data) {
			return [];
		}

		const format = this.detectFormat(data);

		if (format === 'legacy') {
			return listableTags(data);
		}

		// Standard format - just has 'master' tag
		return ['master'];
	}

	/**
	 * Convert tasks and metadata to the appropriate format for saving
	 */
	convertToSaveFormat(
		tasks: Task[],
		metadata: TaskMetadata,
		existingData: any,
		tag: string
	): any {
		const resolvedTag = tag || 'master';

		// Normalize task IDs to strings
		const normalizedTasks = this.normalizeTasks(tasks);

		// Check if existing file uses legacy format
		if (existingData && this.detectFormat(existingData) === 'legacy') {
			return this.convertToLegacyFormat(normalizedTasks, metadata, resolvedTag);
		}

		// Use standard format for new files
		return this.convertToStandardFormat(normalizedTasks, metadata, tag);
	}

	/**
	 * Convert to legacy format
	 */
	private convertToLegacyFormat(
		tasks: Task[],
		metadata: TaskMetadata,
		tag: string
	): any {
		return {
			[tag]: {
				tasks,
				metadata: {
					...metadata,
					tags: [tag]
				}
			}
		};
	}

	/**
	 * Convert to standard format
	 */
	private convertToStandardFormat(
		tasks: Task[],
		metadata: TaskMetadata,
		tag?: string
	): FileStorageData {
		return {
			tasks,
			metadata: {
				...metadata,
				tags: tag ? [tag] : []
			}
		};
	}

	/**
	 * Normalize task and subtask IDs to strings
	 */
	private normalizeTasks(tasks: Task[]): Task[] {
		return tasks.map((task) => ({
			...task,
			id: String(task.id), // Task IDs are strings
			dependencies: task.dependencies?.map((dep) => String(dep)) || [],
			subtasks:
				task.subtasks?.map((subtask) => ({
					...subtask,
					id: String(subtask.id), // Subtask IDs are strings since schema version 2
					parentId: String(subtask.parentId ?? task.id) // Parent ID is string (Task ID); older files omit it
				})) || []
		}));
	}

	/**
	 * Generate metadata from tasks when not present
	 */
	private generateMetadataFromTasks(tasks: Task[], tag: string): TaskMetadata {
		return buildTagMetadata(normalizeTaskStatuses(tasks), tag);
	}
}
