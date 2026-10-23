/**
 * @fileoverview Task Service
 * Core service for task operations - handles business logic between storage and API
 */

import type {
	Subtask,
	Task,
	TaskFilter,
	TaskStatus
} from '../../../common/types/index.js';
import type {
	ArchiveTasksOptions,
	IStorage,
	TaskFieldUpdates,
	UpdateStatusOptions
} from '../../../common/interfaces/storage.interface.js';
import { ConfigManager } from '../../config/managers/config-manager.js';
import { StorageFactory } from '../../storage/services/storage-factory.js';
import {
	satisfyArchivedDependencies,
	withStoredDependencies
} from '../utils/archive.js';
import { selectNextTask } from '../utils/next-task.js';
import { type TaskClaim, resolveClaimant } from '../utils/claim.js';
import { TaskEntity } from '../entities/task.entity.js';
import { normalizeTaskIds } from '../utils/task-ids.js';
import { ERROR_CODES, TaskGraphError } from '../../../common/errors/taskgraph-error.js';
import { getLogger } from '../../../common/logger/factory.js';

/**
 * Result returned by getTaskList
 */
export interface TaskListResult {
	/** The filtered list of tasks */
	tasks: Task[];
	/** Total number of tasks before filtering */
	total: number;
	/** Number of tasks after filtering */
	filtered: number;
	/** The tag these tasks belong to */
	tag?: string;
}

/**
 * Options for getTaskList
 */
export interface GetTaskListOptions {
	/** Optional tag override (uses active tag from config if not provided) */
	tag?: string;
	/** Filter criteria */
	filter?: TaskFilter;
	/** Include subtasks in response */
	includeSubtasks?: boolean;
}

/**
 * TaskService handles all task-related operations
 * This is where business logic lives - it coordinates between ConfigManager and Storage
 */
export class TaskService {
	private configManager: ConfigManager;
	private storage: IStorage;
	private initialized = false;
	private logger = getLogger('TaskService');

	constructor(configManager: ConfigManager) {
		this.configManager = configManager;

		// Storage will be created during initialization
		this.storage = null as any;
	}

	/**
	 * Initialize the service
	 */
	async initialize(): Promise<void> {
		if (this.initialized) return;

		// Create storage based on configuration
		const storageConfig = this.configManager.getStorageConfig();
		const projectRoot = this.configManager.getProjectRoot();

		this.storage = await StorageFactory.createFromStorageConfig(
			storageConfig,
			projectRoot
		);

		// Initialize storage
		await this.storage.initialize();

		this.initialized = true;
	}

	/**
	 * Get list of tasks
	 * This is the main method that retrieves tasks from storage and applies filters
	 */
	async getTaskList(options: GetTaskListOptions = {}): Promise<TaskListResult> {
		// Determine which tag to use
		const activeTag = this.configManager.getActiveTag();
		const tag = options.tag || activeTag;

		try {
			// Determine if we can push filters to storage layer
			const canPushStatusFilter =
				options.filter?.status &&
				!options.filter.priority &&
				!options.filter.tags &&
				!options.filter.assignee &&
				!options.filter.search &&
				options.filter.hasSubtasks === undefined;

			// Build storage-level options
			const storageOptions: any = {};

			// Push status filter to storage if it's the only filter
			if (canPushStatusFilter) {
				const statuses = Array.isArray(options.filter!.status)
					? options.filter!.status
					: [options.filter!.status];
				// Only push single status to storage (multiple statuses need in-memory filtering)
				if (statuses.length === 1) {
					storageOptions.status = statuses[0];
				}
			}

			// Push subtask exclusion to storage
			if (options.includeSubtasks === false) {
				storageOptions.excludeSubtasks = true;
			}

			// Load tasks from storage with pushed-down filters
			const rawTasks = await this.storage.loadTasks(tag, storageOptions);

			// Get total count without status filters, but preserve subtask exclusion
			const baseOptions: any = {};
			if (options.includeSubtasks === false) {
				baseOptions.excludeSubtasks = true;
			}

			const allTasks =
				storageOptions.status !== undefined
					? await this.storage.loadTasks(tag, baseOptions)
					: rawTasks;

			// Convert to TaskEntity for business logic operations
			const taskEntities = TaskEntity.fromArray(rawTasks);

			// Apply remaining filters in-memory if needed
			let filteredEntities = taskEntities;
			if (options.filter && !canPushStatusFilter) {
				filteredEntities = this.applyFilters(taskEntities, options.filter);
			} else if (
				options.filter?.status &&
				Array.isArray(options.filter.status) &&
				options.filter.status.length > 1
			) {
				// Multiple statuses - filter in-memory
				filteredEntities = this.applyFilters(taskEntities, options.filter);
			}

			// Convert back to plain objects
			const tasks = filteredEntities.map((entity) => entity.toJSON());

			return {
				tasks,
				total: allTasks.length,
				filtered: filteredEntities.length,
				tag
			};
		} catch (error) {
			// Re-throw all TaskGraphErrors without wrapping
			// These errors are already user-friendly and have appropriate error codes
			if (error instanceof TaskGraphError) {
				throw error;
			}

			// Only wrap unknown errors
			this.logger.error('Failed to get task list', error);
			throw new TaskGraphError(
				'Failed to get task list',
				ERROR_CODES.INTERNAL_ERROR,
				{
					operation: 'getTaskList',
					tag,
					hasFilter: !!options.filter
				},
				error as Error
			);
		}
	}

	/**
	 * Get a single task by ID - delegates to storage layer. IDs come back as
	 * strings (see normalizeTaskIds)
	 */
	async getTask(taskId: string, tag?: string): Promise<Task | null> {
		// Use provided tag or get active tag
		const activeTag = tag || this.getActiveTag();

		try {
			// Delegate to storage layer which handles the specific logic for tasks vs subtasks
			const task = await this.storage.loadTask(String(taskId), activeTag);
			// IDs as strings, as getTaskList gives them, so show agrees with list
			return task ? normalizeTaskIds(task) : null;
		} catch (error) {
			// Re-throw all TaskGraphErrors without wrapping
			if (error instanceof TaskGraphError) {
				throw error;
			}

			throw new TaskGraphError(
				`Failed to get task ${taskId}`,
				ERROR_CODES.STORAGE_ERROR,
				{
					operation: 'getTask',
					resource: 'task',
					taskId: String(taskId),
					tag: activeTag
				},
				error as Error
			);
		}
	}

	/**
	 * Get tasks filtered by status
	 */
	async getTasksByStatus(
		status: TaskStatus | TaskStatus[],
		tag?: string
	): Promise<Task[]> {
		const statuses = Array.isArray(status) ? status : [status];

		const result = await this.getTaskList({
			tag,
			filter: { status: statuses }
		});

		return result.tasks;
	}

	/**
	 * Get statistics about tasks
	 */
	async getTaskStats(tag?: string): Promise<{
		total: number;
		byStatus: Record<TaskStatus, number>;
		withSubtasks: number;
		blocked: number;
	}> {
		const result = await this.getTaskList({
			tag,
			includeSubtasks: true
		});

		const stats = {
			total: result.total,
			byStatus: {} as Record<TaskStatus, number>,
			withSubtasks: 0,
			blocked: 0
		};

		// Initialize all statuses
		const allStatuses: TaskStatus[] = [
			'pending',
			'in-progress',
			'done',
			'deferred',
			'cancelled',
			'blocked',
			'review'
		];

		allStatuses.forEach((status) => {
			stats.byStatus[status] = 0;
		});

		// Count tasks
		result.tasks.forEach((task) => {
			stats.byStatus[task.status]++;

			if (task.subtasks && task.subtasks.length > 0) {
				stats.withSubtasks++;
			}

			if (task.status === 'blocked') {
				stats.blocked++;
			}
		});

		return stats;
	}

	/**
	 * Get next available task to work on
	 * Prioritizes eligible subtasks from in-progress parent tasks before falling back to top-level tasks
	 */
	async getNextTask(tag?: string): Promise<Task | null> {
		const { tasks } = await this.getTaskList({ tag });
		const picked = selectNextTask(
			satisfyArchivedDependencies(tasks, await this.getArchivedTaskIds(tag))
		);
		// Show the dependencies it really has; archived ones count as done
		return picked ? withStoredDependencies(picked, tasks) : null;
	}

	/**
	 * Throw NOT_FOUND when a tag is named that the project doesn't have, so
	 * a typo isn't read as an empty tag. A project with no tags yet passes.
	 */
	async assertTagExists(tag: string): Promise<void> {
		const tags = await this.storage.getAllTags();
		if (tags.length && !tags.includes(tag)) {
			throw new TaskGraphError(
				`Tag "${tag}" not found`,
				ERROR_CODES.NOT_FOUND,
				{ tagName: tag }
			);
		}
	}

	/**
	 * A tag's tasks for readiness, blocker and tree logic: dependencies on
	 * archived tasks are taken out, since those count as done. Read only;
	 * never save the result.
	 */
	async getDependencyView(tag?: string): Promise<Task[]> {
		const result = await this.getTaskList({ tag });
		return satisfyArchivedDependencies(
			result.tasks,
			await this.getArchivedTaskIds(tag)
		);
	}

	/**
	 * IDs of the tasks archived in a tag (the active tag when omitted)
	 */
	async getArchivedTaskIds(tag?: string): Promise<Set<string>> {
		return this.storage.loadArchivedTaskIds(tag || this.getActiveTag());
	}

	/**
	 * Move done and cancelled tasks last changed at least `olderThanDays`
	 * ago into the archive, in one locked write
	 * @returns The tasks archived (or that would be, with dryRun)
	 */
	async archiveTasks(
		options: ArchiveTasksOptions,
		tag?: string
	): Promise<Task[]> {
		return this.storage.archiveTasks(options, tag || this.getActiveTag());
	}

	/**
	 * Move one archived task back into tasks.json
	 */
	async restoreArchivedTask(taskId: string, tag?: string): Promise<Task> {
		return this.storage.restoreArchivedTask(
			taskId,
			tag || this.getActiveTag()
		);
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
		const activeTag = tag || this.getActiveTag();
		return this.storage.claimNextTask(
			claimant?.trim() || resolveClaimant(),
			activeTag,
			among
		);
	}

	/**
	 * Apply filters to task entities
	 */
	private applyFilters(tasks: TaskEntity[], filter: TaskFilter): TaskEntity[] {
		return tasks.filter((task) => {
			// Status filter
			if (filter.status) {
				const statuses = Array.isArray(filter.status)
					? filter.status
					: [filter.status];
				if (!statuses.includes(task.status)) {
					return false;
				}
			}

			// Priority filter
			if (filter.priority) {
				const priorities = Array.isArray(filter.priority)
					? filter.priority
					: [filter.priority];
				if (!priorities.includes(task.priority)) {
					return false;
				}
			}

			// Tags filter
			if (filter.tags && filter.tags.length > 0) {
				if (
					!task.tags ||
					!filter.tags.some((tag) => task.tags?.includes(tag))
				) {
					return false;
				}
			}

			// Assignee filter
			if (filter.assignee) {
				if (task.assignee !== filter.assignee) {
					return false;
				}
			}

			// Search filter
			if (filter.search) {
				const searchLower = filter.search.toLowerCase();
				const inTitle = task.title.toLowerCase().includes(searchLower);
				const inDescription = task.description
					.toLowerCase()
					.includes(searchLower);
				const inDetails = task.details.toLowerCase().includes(searchLower);

				if (!inTitle && !inDescription && !inDetails) {
					return false;
				}
			}

			// Has subtasks filter
			if (filter.hasSubtasks !== undefined) {
				const hasSubtasks = task.subtasks.length > 0;
				if (hasSubtasks !== filter.hasSubtasks) {
					return false;
				}
			}

			return true;
		});
	}

	/**
	 * Get the storage instance
	 * Internal use only - used by other services in the tasks module
	 */
	getStorage(): IStorage {
		return this.storage;
	}

	/**
	 * Get current active tag from local config/state
	 */
	getActiveTag(): string {
		return this.configManager.getActiveTag();
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

		// Use provided tag or get active tag
		const activeTag = tag || this.getActiveTag();
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
			tag || this.getActiveTag()
		);
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
		// Ensure we have storage
		if (!this.storage) {
			throw new TaskGraphError(
				'Storage not initialized',
				ERROR_CODES.STORAGE_ERROR
			);
		}

		// Use provided tag or get active tag
		const activeTag = tag || this.getActiveTag();
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

	/**
	 * Get all tags with detailed statistics including task counts
	 * Delegates to storage layer which handles file vs API implementation
	 */
	async getTagsWithStats() {
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

		try {
			return await this.storage.getTagsWithStats();
		} catch (error) {
			// Re-throw all TaskGraphErrors without wrapping
			if (error instanceof TaskGraphError) {
				throw error;
			}

			throw new TaskGraphError(
				'Failed to get tags with stats',
				ERROR_CODES.STORAGE_ERROR,
				{
					operation: 'getTagsWithStats',
					resource: 'tags'
				},
				error as Error
			);
		}
	}

	/**
	 * Close and cleanup resources
	 * Releases file locks and other storage resources
	 */
	async close(): Promise<void> {
		if (this.storage) {
			await this.storage.close();
		}
		this.initialized = false;
	}
}
