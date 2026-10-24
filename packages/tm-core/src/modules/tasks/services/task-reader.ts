/**
 * @fileoverview Task Reader
 * The read side of TaskService: storage setup, tag resolution, and task
 * queries. TaskService extends it with the writes.
 */

import type {
	Task,
	TaskFilter,
	TaskStatus
} from '../../../common/types/index.js';
import type { IStorage } from '../../../common/interfaces/storage.interface.js';
import { ConfigManager } from '../../config/managers/config-manager.js';
import { StorageFactory } from '../../storage/services/storage-factory.js';
import {
	satisfyArchivedDependencies,
	withStoredDependencies
} from '../utils/archive.js';
import { selectNextTask } from '../utils/next-task.js';
import { TaskEntity } from '../entities/task.entity.js';
import { normalizeTaskIds } from '../utils/task-ids.js';
import { promotedSubtaskDescription } from '../utils/promoted-subtask.js';
import {
	ERROR_CODES,
	MISSING_TAG_HINT,
	TaskGraphError
} from '../../../common/errors/taskgraph-error.js';
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
 * Reads tasks from storage; TaskService adds the writes
 */
export class TaskReader {
	protected configManager: ConfigManager;
	protected storage: IStorage;
	protected initialized = false;
	protected logger = getLogger('TaskService');

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
		const tag = options.tag || this.getActiveTag();

		try {
			await this.resolveTag(tag);

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
	 * Whether the project has this tag. "master" always does (reads fall back
	 * to it), and so does any tag while tasks.json has none yet
	 */
	async tagExists(tag: string): Promise<boolean> {
		if (tag === 'master') {
			return true;
		}
		const tags = await this.storage.getAllTags();
		return tags.length === 0 || tags.includes(tag);
	}

	/**
	 * The tag to read or change: `tag`, else the active tag. Fails on one the
	 * project doesn't have, so a typo or a stale active tag (say after a git
	 * checkout) isn't read as an empty tag
	 */
	protected async resolveTag(tag?: string): Promise<string> {
		const activeTag = this.getActiveTag();
		const resolved = tag || activeTag;
		if (await this.tagExists(resolved)) {
			return resolved;
		}
		if (resolved !== activeTag) {
			throw Object.assign(
				new TaskGraphError(
					`Tag "${resolved}" not found`,
					ERROR_CODES.NOT_FOUND,
					{ tagName: resolved }
				),
				{ hint: MISSING_TAG_HINT }
			);
		}
		throw Object.assign(
			new TaskGraphError(
				`Active tag "${resolved}" isn't in tasks.json`,
				ERROR_CODES.NOT_FOUND,
				{ tagName: resolved }
			),
			{
				hint: 'Switch with `taskgraph tags use <tag>`; `taskgraph tags` lists them'
			}
		);
	}

	/**
	 * Get a single task by ID - delegates to storage layer. IDs come back as
	 * strings (see normalizeTaskIds)
	 */
	async getTask(taskId: string, tag?: string): Promise<Task | null> {
		const activeTag = await this.resolveTag(tag);

		try {
			// Delegate to storage layer which handles the specific logic for tasks vs subtasks
			const task = await this.storage.loadTask(String(taskId), activeTag);
			if (!task) {
				return null;
			}
			// IDs as strings, as getTaskList gives them, so show agrees with list
			const normalized = normalizeTaskIds(task);
			// A task with no description takes its title, as in getTaskList. A
			// subtask (dotted ID) keeps its own, which is optional
			return String(taskId).includes('.')
				? normalized
				: { ...normalized, description: promotedSubtaskDescription(task) };
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
	 * Whether tasks.json has the tag. tagExists also accepts a missing master,
	 * which storage reads as the first tag; the dependency commands read it as
	 * empty instead, as the legacy commands did.
	 */
	protected async tagInFile(tag: string): Promise<boolean> {
		const tags = await this.storage.getAllTags();
		return tags.length === 0 || tags.includes(tag);
	}

	/**
	 * A tag's tasks as stored (IDs not normalized) and its archived task IDs,
	 * read without taking the write lock
	 */
	async loadStoredTasks(tag?: string): Promise<{
		tasks: Task[];
		archivedIds: ReadonlySet<string>;
		tag: string;
	}> {
		if (!this.initialized) {
			await this.initialize();
		}
		const resolvedTag = await this.resolveTag(tag);
		return {
			tasks: (await this.tagInFile(resolvedTag))
				? await this.storage.loadTasks(resolvedTag)
				: [],
			archivedIds: await this.storage.loadArchivedTaskIds(resolvedTag),
			tag: resolvedTag
		};
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
