/**
 * @fileoverview Storage interface definitions for the tm-core package
 * This file defines the contract for all storage implementations
 */

import type { TaskClaim } from '../../modules/tasks/utils/claim.js';
import type {
	Subtask,
	Task,
	TaskMetadata,
	TaskStatus
} from '../types/index.js';

/**
 * Options for loading tasks from storage
 */
export interface LoadTasksOptions {
	/** Filter tasks by status */
	status?: TaskStatus;
	/** Exclude subtasks from loaded tasks (default: false) */
	excludeSubtasks?: boolean;
}

/**
 * Result type for updateTaskStatus operations
 */
export interface UpdateStatusResult {
	success: boolean;
	oldStatus: TaskStatus;
	newStatus: TaskStatus;
	taskId: string;
}

/**
 * Options for updateTaskStatus operations
 */
export interface UpdateStatusOptions {
	/**
	 * Asked inside the write, with the task as stored, before it moves to
	 * done; return an error to refuse the change. Also asked (with `auto`
	 * true) before a parent moves to done because its last subtask finished;
	 * refusing then leaves the parent in progress.
	 */
	guardDone?: (
		task: Task | Subtask,
		taskId: string,
		auto: boolean
	) => Error | undefined;
}

/**
 * Fields a modifyTask change can set on a task or subtask
 */
export type TaskFieldUpdates = Partial<
	Omit<Task, 'id' | 'subtasks' | 'dependencies'>
>;

/**
 * Interface for storage operations on tasks
 * All storage implementations must implement this interface
 */
export interface IStorage {
	/**
	 * Load all tasks from storage, optionally filtered by tag and other criteria
	 * @param tag - Optional tag to filter tasks by
	 * @param options - Optional filtering options (status, excludeSubtasks)
	 * @returns Promise that resolves to an array of tasks
	 */
	loadTasks(tag?: string, options?: LoadTasksOptions): Promise<Task[]>;

	/**
	 * Load a single task by ID
	 * @param taskId - ID of the task to load
	 * @param tag - Optional tag context for the task
	 * @returns Promise that resolves to the task or null if not found
	 */
	loadTask(taskId: string, tag?: string): Promise<Task | null>;

	/**
	 * Save tasks to storage, replacing existing tasks
	 * @param tasks - Array of tasks to save
	 * @param tag - Optional tag context for the tasks
	 * @returns Promise that resolves when save is complete
	 */
	saveTasks(tasks: Task[], tag?: string): Promise<void>;

	/**
	 * Append new tasks to existing storage without replacing
	 * @param tasks - Array of tasks to append
	 * @param tag - Optional tag context for the tasks
	 * @returns Promise that resolves when append is complete
	 */
	appendTasks(tasks: Task[], tag?: string): Promise<void>;

	/**
	 * Update a specific task by ID (direct structural update)
	 * @param taskId - ID of the task to update
	 * @param updates - Partial task object with fields to update
	 * @param tag - Optional tag context for the task
	 * @returns Promise that resolves when update is complete
	 */
	updateTask(
		taskId: string,
		updates: Partial<Task>,
		tag?: string
	): Promise<void>;

	/**
	 * Update task or subtask status by ID
	 * @param taskId - ID of the task or subtask (e.g., "1" or "1.2")
	 * @param newStatus - New status to set
	 * @param tag - Optional tag context for the task
	 * @returns Promise that resolves to update result with old and new status
	 */
	updateTaskStatus(
		taskId: string,
		newStatus: TaskStatus,
		tag?: string,
		options?: UpdateStatusOptions
	): Promise<UpdateStatusResult>;

	/**
	 * Change one task or subtask in a single locked read-modify-write
	 * @param taskId - ID of the task or subtask (e.g., "1" or "1.2")
	 * @param change - Gets the item as stored; returns the fields to set, or
	 *   throws to leave the file unchanged
	 * @param tag - Optional tag context for the task
	 * @returns The item as saved
	 */
	modifyTask(
		taskId: string,
		change: (task: Task | Subtask, isSubtask: boolean) => TaskFieldUpdates,
		tag?: string
	): Promise<Task | Subtask>;

	/**
	 * Pick the next task nobody has started and set it in-progress, recording
	 * the claim in its metadata, all in one locked write
	 * @param claimant - Recorded as `metadata.claimedBy`
	 * @param tag - Optional tag context
	 * @returns The claim, or null when no task is ready
	 */
	claimNextTask(claimant: string, tag?: string): Promise<TaskClaim | null>;

	/**
	 * Delete a task by ID
	 * @param taskId - ID of the task to delete
	 * @param tag - Optional tag context for the task
	 * @returns Promise that resolves when deletion is complete
	 */
	deleteTask(taskId: string, tag?: string): Promise<void>;

	/**
	 * Check if tasks exist in storage for the given tag
	 * @param tag - Optional tag to check existence for
	 * @returns Promise that resolves to boolean indicating existence
	 */
	exists(tag?: string): Promise<boolean>;

	/**
	 * Load metadata about the task collection
	 * @param tag - Optional tag to get metadata for
	 * @returns Promise that resolves to task metadata
	 */
	loadMetadata(tag?: string): Promise<TaskMetadata | null>;

	/**
	 * Save metadata about the task collection
	 * @param metadata - Metadata object to save
	 * @param tag - Optional tag context for the metadata
	 * @returns Promise that resolves when save is complete
	 */
	saveMetadata(metadata: TaskMetadata, tag?: string): Promise<void>;

	/**
	 * Get all available tags in storage
	 * @returns Promise that resolves to array of available tags
	 */
	getAllTags(): Promise<string[]>;

	/**
	 * Create a new tag
	 * @param tagName - Name of the tag to create
	 * @param options - Creation options
	 * @param options.copyFrom - Tag to copy tasks from (optional)
	 * @param options.description - Tag description (optional)
	 * @returns Promise that resolves when creation is complete
	 */
	createTag(
		tagName: string,
		options?: { copyFrom?: string; description?: string }
	): Promise<void>;

	/**
	 * Delete all tasks and metadata for a specific tag
	 * @param tag - Tag to delete
	 * @returns Promise that resolves when deletion is complete
	 */
	deleteTag(tag: string): Promise<void>;

	/**
	 * Rename a tag (move all tasks from old tag to new tag)
	 * @param oldTag - Current tag name
	 * @param newTag - New tag name
	 * @returns Promise that resolves when rename is complete
	 */
	renameTag(oldTag: string, newTag: string): Promise<void>;

	/**
	 * Copy all tasks from one tag to another
	 * @param sourceTag - Source tag to copy from
	 * @param targetTag - Target tag to copy to
	 * @returns Promise that resolves when copy is complete
	 */
	copyTag(sourceTag: string, targetTag: string): Promise<void>;

	/**
	 * Initialize storage (create necessary directories, files, etc.)
	 * @returns Promise that resolves when initialization is complete
	 */
	initialize(): Promise<void>;

	/**
	 * Clean up and close storage connections
	 * @returns Promise that resolves when cleanup is complete
	 */
	close(): Promise<void>;

	/**
	 * Get storage statistics (file sizes, task counts, etc.)
	 * @returns Promise that resolves to storage statistics
	 */
	getStats(): Promise<StorageStats>;

	/**
	 * Get all tags with detailed statistics including task counts
	 * @returns Promise that resolves to tags with statistics
	 */
	getTagsWithStats(): Promise<TagsWithStatsResult>;

	/**
	 * Watch for changes to tasks
	 * @param callback - Function called when tasks change
	 * @param options - Watch options (debounce, tag)
	 * @returns Subscription handle with unsubscribe method
	 */
	watch(
		callback: (event: WatchEvent) => void,
		options?: WatchOptions
	): Promise<WatchSubscription>;
}

/**
 * Tag information with detailed statistics
 */
export interface TagInfo {
	/** Tag/Brief name */
	name: string;
	/** Whether this is the current/active tag */
	isCurrent: boolean;
	/** Total number of tasks in this tag */
	taskCount: number;
	/** Number of complete tasks (done or cancelled) */
	completedTasks: number;
	/** Number of tasks ready to start (actionable, dependencies complete) */
	readyTasks: number;
	/** Breakdown of tasks by status */
	statusBreakdown: Record<string, number>;
	/** Subtask counts if available */
	subtaskCounts?: {
		totalSubtasks: number;
		subtasksByStatus: Record<string, number>;
	};
	/** Tag creation date */
	created?: string;

	/** Tag last modified date */
	updatedAt?: string;

	/** Tag description */
	description?: string;
	/** Tag status */
	status?: string;
}

/**
 * Result returned by getTagsWithStats
 */
export interface TagsWithStatsResult {
	/** List of tags with statistics */
	tags: TagInfo[];
	/** Current active tag name */
	currentTag: string | null;
	/** Total number of tags */
	totalTags: number;
}

/**
 * Watch event types
 */
export type WatchEventType = 'change' | 'error';

/**
 * Watch event payload
 */
export interface WatchEvent {
	/** Type of event */
	type: WatchEventType;
	/** Timestamp of the event */
	timestamp: Date;
	/** Error if type is 'error' */
	error?: Error;
}

/**
 * Watch options
 */
export interface WatchOptions {
	/** Debounce time in milliseconds (default: 100) */
	debounceMs?: number;
	/** Tag context for file storage */
	tag?: string;
}

/**
 * Watch subscription handle
 */
export interface WatchSubscription {
	/** Unsubscribe from watch events */
	unsubscribe: () => void;
}

/**
 * Storage statistics interface
 */
export interface StorageStats {
	/** Total number of tasks across all tags */
	totalTasks: number;
	/** Total number of tags */
	totalTags: number;
	/** Storage size in bytes */
	storageSize: number;
	/** Last modified timestamp */
	lastModified: string;
	/** Available tags with task counts */
	tagStats: Array<{
		tag: string;
		taskCount: number;
		lastModified: string;
	}>;
}

/**
 * Configuration options for storage implementations
 */
export interface StorageConfig {
	/** Base path for storage */
	basePath: string;
	/** Enable backup creation */
	enableBackup?: boolean;
	/** Maximum number of backups to keep */
	maxBackups?: number;
	/** Enable compression for storage */
	enableCompression?: boolean;
	/** File encoding (default: utf8) */
	encoding?: BufferEncoding;
	/** Enable atomic writes */
	atomicWrites?: boolean;
}

/**
 * Base abstract class for storage implementations
 * Provides common functionality and enforces the interface
 */
export abstract class BaseStorage implements IStorage {
	protected config: StorageConfig;

	constructor(config: StorageConfig) {
		this.config = config;
	}

	// Abstract methods that must be implemented by concrete classes
	abstract loadTasks(tag?: string, options?: LoadTasksOptions): Promise<Task[]>;
	abstract loadTask(taskId: string, tag?: string): Promise<Task | null>;
	abstract saveTasks(tasks: Task[], tag?: string): Promise<void>;
	abstract appendTasks(tasks: Task[], tag?: string): Promise<void>;
	abstract updateTask(
		taskId: string,
		updates: Partial<Task>,
		tag?: string
	): Promise<void>;
	abstract updateTaskStatus(
		taskId: string,
		newStatus: TaskStatus,
		tag?: string,
		options?: UpdateStatusOptions
	): Promise<UpdateStatusResult>;
	abstract modifyTask(
		taskId: string,
		change: (task: Task | Subtask, isSubtask: boolean) => TaskFieldUpdates,
		tag?: string
	): Promise<Task | Subtask>;

	abstract claimNextTask(
		claimant: string,
		tag?: string
	): Promise<TaskClaim | null>;
	abstract deleteTask(taskId: string, tag?: string): Promise<void>;
	abstract exists(tag?: string): Promise<boolean>;
	abstract loadMetadata(tag?: string): Promise<TaskMetadata | null>;
	abstract saveMetadata(metadata: TaskMetadata, tag?: string): Promise<void>;
	abstract getAllTags(): Promise<string[]>;
	abstract createTag(
		tagName: string,
		options?: { copyFrom?: string; description?: string }
	): Promise<void>;
	abstract deleteTag(tag: string): Promise<void>;
	abstract renameTag(oldTag: string, newTag: string): Promise<void>;
	abstract copyTag(sourceTag: string, targetTag: string): Promise<void>;
	abstract initialize(): Promise<void>;
	abstract close(): Promise<void>;
	abstract getStats(): Promise<StorageStats>;
	abstract getTagsWithStats(): Promise<TagsWithStatsResult>;
	abstract watch(
		callback: (event: WatchEvent) => void,
		options?: WatchOptions
	): Promise<WatchSubscription>;
	/**
	 * Utility method to generate backup filename
	 * @param originalPath - Original file path
	 * @returns Backup file path with timestamp
	 */
	protected generateBackupPath(originalPath: string): string {
		const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
		const parts = originalPath.split('.');
		const extension = parts.pop();
		const baseName = parts.join('.');
		return `${baseName}.backup.${timestamp}.${extension}`;
	}

	/**
	 * Utility method to validate task data before storage operations
	 * @param task - Task to validate
	 * @throws Error if task is invalid
	 */
	protected validateTask(task: Task): void {
		if (!task.id) {
			throw new Error('Task ID is required');
		}
		if (!task.title) {
			throw new Error('Task title is required');
		}
		if (!task.description) {
			throw new Error('Task description is required');
		}
		if (!task.status) {
			throw new Error('Task status is required');
		}
	}

	/**
	 * Utility method to sanitize tag names for file system safety
	 * @param tag - Tag name to sanitize
	 * @returns Sanitized tag name
	 */
	protected sanitizeTag(tag: string): string {
		return tag.replace(/[^a-zA-Z0-9-_]/g, '-').toLowerCase();
	}
}
