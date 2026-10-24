/**
 * @fileoverview File-based storage implementation for TaskGraph
 */

import fs from 'node:fs';
import {
	ERROR_CODES,
	TaskGraphError
} from '../../../../common/errors/taskgraph-error.js';
import type {
	ArchiveTasksOptions,
	IStorage,
	LoadTasksOptions,
	MutateTags,
	StorageStats,
	TaskFieldUpdates,
	UpdateStatusOptions,
	UpdateStatusResult,
	WatchEvent,
	WatchOptions,
	WatchSubscription
} from '../../../../common/interfaces/storage.interface.js';
import type {
	Subtask,
	Task,
	TaskMetadata,
	TaskStatus
} from '../../../../common/types/index.js';
import { resolveSubtaskDependency } from '../../../dependencies/subtask-dependency.js';
import { subtaskInContext } from '../../../tasks/utils/subtask-context.js';
import { ComplexityReportManager } from '../../../reports/managers/complexity-report-manager.js';
import {
	type ArchiveData,
	addToArchive,
	archivedTaskIds,
	insertById,
	selectArchivable,
	takeFromArchive
} from '../../../tasks/utils/archive.js';
import {
	type TaskClaim,
	claimNextInTasks
} from '../../../tasks/utils/claim.js';
import { FileOperations } from './file-operations.js';
import { FormatHandler } from './format-handler.js';
import { PathResolver } from './path-resolver.js';
import {
	applyTagUpdate,
	buildTagMetadata,
	mutateTagsIn
} from './tag-update.js';
import { warnIfUnsupportedSchema } from './schema-version.js';
import { TagOperations } from './tag-operations.js';
import {
	modifyTaskIn,
	setTaskStatusIn,
	taskNotFound,
	withFreeIds
} from './task-updates.js';

/** What a mutateTasks change returns */
interface MutateOutcome<R> {
	/** The tag's new tasks, or null to leave the file untouched */
	tasks: Task[] | null;
	result: R;
	/** Runs after tasks.json is written, while its lock is still held */
	afterWrite?: () => Promise<void>;
}

/**
 * File-based storage implementation using a single tasks.json file with separated concerns
 */
export class FileStorage implements IStorage {
	private formatHandler: FormatHandler;
	private fileOps: FileOperations;
	private pathResolver: PathResolver;
	private complexityManager: ComplexityReportManager;
	private tagOps: TagOperations;

	constructor(projectPath: string) {
		this.formatHandler = new FormatHandler();
		this.fileOps = new FileOperations();
		this.pathResolver = new PathResolver(projectPath);
		this.complexityManager = new ComplexityReportManager(projectPath);
		this.tagOps = new TagOperations(
			this.pathResolver,
			this.fileOps,
			this.formatHandler,
			this
		);
	}

	/**
	 * Initialize storage by creating necessary directories
	 */
	async initialize(): Promise<void> {
		await this.fileOps.ensureDir(this.pathResolver.getTasksDir());
	}

	/**
	 * Close storage and cleanup resources
	 */
	async close(): Promise<void> {
		await this.fileOps.cleanup();
	}

	/**
	 * Get statistics about the storage
	 */
	async getStats(): Promise<StorageStats> {
		const filePath = this.pathResolver.getTasksPath();

		try {
			const stats = await this.fileOps.getStats(filePath);
			const data = await this.fileOps.readJson(filePath);
			const tags = this.formatHandler.extractTags(data);

			let totalTasks = 0;
			const tagStats = tags.map((tag) => {
				const tasks = this.formatHandler.extractTasks(data, tag);
				const taskCount = tasks.length;
				totalTasks += taskCount;

				return {
					tag,
					taskCount,
					lastModified: stats.mtime.toISOString()
				};
			});

			return {
				totalTasks,
				totalTags: tags.length,
				lastModified: stats.mtime.toISOString(),
				storageSize: 0, // Could calculate actual file sizes if needed
				tagStats
			};
		} catch (error: any) {
			if (error.code === 'ENOENT') {
				return {
					totalTasks: 0,
					totalTags: 0,
					lastModified: new Date().toISOString(),
					storageSize: 0,
					tagStats: []
				};
			}
			throw new Error(`Failed to get storage stats: ${error.message}`);
		}
	}

	/**
	 * Load tasks from the single tasks.json file for a specific tag
	 * Enriches tasks with complexity data from the complexity report
	 */
	async loadTasks(tag?: string, options?: LoadTasksOptions): Promise<Task[]> {
		const filePath = this.pathResolver.getTasksPath();
		const resolvedTag = tag || 'master';

		try {
			const rawData = await this.fileOps.readJson(filePath);
			let tasks = this.formatHandler.extractTasks(rawData, resolvedTag);
			warnIfUnsupportedSchema(
				this.formatHandler.extractMetadata(rawData, resolvedTag),
				resolvedTag,
				filePath
			);

			// Apply filters if provided
			if (options) {
				// Filter by status if specified
				if (options.status) {
					tasks = tasks.filter((task) => task.status === options.status);
				}

				// Exclude subtasks if specified
				if (options.excludeSubtasks) {
					tasks = tasks.map((task) => ({
						...task,
						subtasks: []
					}));
				}
			}

			return await this.enrichTasksWithComplexity(tasks, resolvedTag);
		} catch (error: any) {
			if (error.code === 'ENOENT') {
				return []; // File doesn't exist, return empty array
			}
			// Already says what went wrong (e.g. a corrupt tasks.json)
			if (error instanceof TaskGraphError) {
				throw error;
			}
			throw new Error(`Failed to load tasks: ${error.message}`);
		}
	}

	/**
	 * Load a single task by ID from the tasks.json file
	 * Handles both regular tasks and subtasks (with dotted notation like "1.2")
	 */
	async loadTask(taskId: string, tag?: string): Promise<Task | null> {
		const tasks = await this.loadTasks(tag);

		// Check if this is a subtask (contains a dot)
		if (taskId.includes('.')) {
			const [parentId, subtaskId] = taskId.split('.');
			const parentTask = tasks.find((t) => String(t.id) === parentId);

			if (!parentTask || !parentTask.subtasks) {
				return null;
			}

			const subtask = parentTask.subtasks.find(
				(st) => String(st.id) === subtaskId
			);
			if (!subtask) {
				return null;
			}

			// The view tasks.get gives, with the full dotted ID and resolved deps
			return {
				...subtaskInContext(parentTask, subtask),
				id: taskId,
				dependencies:
					subtask.dependencies?.map((dep) =>
						resolveSubtaskDependency(parentTask.id, dep)
					) ?? [],
				subtasks: []
			};
		}

		return tasks.find((task) => String(task.id) === String(taskId)) || null;
	}

	/**
	 * Save tasks for a specific tag in the single tasks.json file
	 * Uses modifyJson for atomic read-modify-write to prevent lost updates
	 */
	async saveTasks(tasks: Task[], tag?: string): Promise<void> {
		const filePath = this.pathResolver.getTasksPath();
		const resolvedTag = tag || 'master';

		await this.fileOps.ensureDir(this.pathResolver.getTasksDir());

		const metadata = buildTagMetadata(tasks, resolvedTag);

		await this.fileOps.modifyJson(filePath, (existingData: any) =>
			applyTagUpdate(
				this.formatHandler,
				existingData,
				resolvedTag,
				tasks,
				metadata
			)
		);
	}

	/**
	 * Read-modify-write one tag under the file lock. The tasks are read inside
	 * the lock, so a change made by another writer since the caller started is
	 * never overwritten. Return `tasks: null` to leave the file untouched.
	 * A throw from `mutate` aborts the write.
	 */
	private async mutateTasks<R>(
		tag: string | undefined,
		mutate: (tasks: Task[]) => MutateOutcome<R> | Promise<MutateOutcome<R>>
	): Promise<R> {
		const filePath = this.pathResolver.getTasksPath();
		const resolvedTag = tag || 'master';
		let result!: R;
		let afterWrite: (() => Promise<void>) | undefined;

		await this.fileOps.ensureDir(this.pathResolver.getTasksDir());
		await this.fileOps.modifyJson(
			filePath,
			async (existingData: any) => {
				const current = this.formatHandler.extractTasks(
					existingData,
					resolvedTag
				);
				const outcome = await mutate(current);
				result = outcome.result;
				afterWrite = outcome.afterWrite;
				if (outcome.tasks === null) {
					return existingData;
				}
				return applyTagUpdate(
					this.formatHandler,
					existingData,
					resolvedTag,
					outcome.tasks,
					buildTagMetadata(outcome.tasks, resolvedTag)
				);
			},
			{ afterWrite: () => afterWrite?.() ?? Promise.resolve() }
		);

		return result;
	}

	/** See IStorage.mutateTags */
	async mutateTags<R>(mutate: MutateTags<R>): Promise<R> {
		let result!: R;
		await this.fileOps.ensureDir(this.pathResolver.getTasksDir());
		await this.fileOps.modifyJson(
			this.pathResolver.getTasksPath(),
			async (data) => {
				const outcome = await mutateTagsIn(this.formatHandler, data, mutate);
				result = outcome.result;
				return outcome.data;
			}
		);
		return result;
	}

	/**
	 * Check if the tasks file exists
	 */
	async exists(_tag?: string): Promise<boolean> {
		const filePath = this.pathResolver.getTasksPath();
		return this.fileOps.exists(filePath);
	}

	/**
	 * Get all available tags from the single tasks.json file
	 */
	async getAllTags(): Promise<string[]> {
		try {
			const filePath = this.pathResolver.getTasksPath();
			const data = await this.fileOps.readJson(filePath);
			return this.formatHandler.extractTags(data);
		} catch (error: any) {
			if (error.code === 'ENOENT') {
				return []; // File doesn't exist
			}
			if (error instanceof TaskGraphError) {
				throw error;
			}
			throw new Error(`Failed to get tags: ${error.message}`);
		}
	}

	/**
	 * Load metadata from the single tasks.json file for a specific tag
	 */
	async loadMetadata(tag?: string): Promise<TaskMetadata | null> {
		const filePath = this.pathResolver.getTasksPath();
		const resolvedTag = tag || 'master';

		try {
			const rawData = await this.fileOps.readJson(filePath);
			return this.formatHandler.extractMetadata(rawData, resolvedTag);
		} catch (error: any) {
			if (error.code === 'ENOENT') {
				return null;
			}
			throw new Error(`Failed to load metadata: ${error.message}`);
		}
	}

	/**
	 * Save metadata (stored with tasks)
	 */
	async saveMetadata(_metadata: TaskMetadata, tag?: string): Promise<void> {
		const tasks = await this.loadTasks(tag);
		await this.saveTasks(tasks, tag);
	}

	/** Append tasks (see withFreeIds) */
	async appendTasks(tasks: Task[], tag?: string): Promise<Task[]> {
		return this.mutateTasks(tag, async (existing) =>
			withFreeIds(existing, tasks, await this.readArchive(), tag || 'master')
		);
	}

	/**
	 * Update a specific task
	 */
	async updateTask(
		taskId: string,
		updates: Partial<Task>,
		tag?: string
	): Promise<void> {
		await this.mutateTasks(tag, (tasks) => {
			const taskIndex = tasks.findIndex((t) => String(t.id) === String(taskId));

			if (taskIndex === -1) {
				throw taskNotFound(`Task ${taskId} not found`);
			}

			const existingTask = tasks[taskIndex];

			// Preserve subtask metadata when subtasks are updated
			// AI operations don't include metadata in returned subtasks
			let mergedSubtasks = updates.subtasks;
			if (updates.subtasks && existingTask.subtasks) {
				mergedSubtasks = updates.subtasks.map((updatedSubtask) => {
					// Type-coerce IDs for comparison; fall back to title match if IDs don't match
					const originalSubtask = existingTask.subtasks?.find(
						(st) =>
							String(st.id) === String(updatedSubtask.id) ||
							(updatedSubtask.title && st.title === updatedSubtask.title)
					);
					// Merge metadata: preserve original and add/override with new
					if (originalSubtask?.metadata || updatedSubtask.metadata) {
						return {
							...updatedSubtask,
							metadata: {
								...(originalSubtask?.metadata || {}),
								...(updatedSubtask.metadata || {})
							}
						};
					}
					return updatedSubtask;
				});
			}

			const updated = [...tasks];
			updated[taskIndex] = {
				...existingTask,
				...updates,
				...(mergedSubtasks && { subtasks: mergedSubtasks }),
				id: String(taskId) // Keep consistent with normalizeTaskIds
			};
			return { tasks: updated, result: undefined };
		});
	}

	/**
	 * Update task or subtask status by ID - handles file storage logic with parent/subtask relationships
	 */
	async updateTaskStatus(
		taskId: string,
		newStatus: TaskStatus,
		tag?: string,
		options: UpdateStatusOptions = {}
	): Promise<UpdateStatusResult> {
		return this.mutateTasks(tag, (tasks) =>
			setTaskStatusIn(tasks, taskId, newStatus, options)
		);
	}

	/** Claim the next unstarted task, from `among` if set, under the file lock */
	async claimNextTask(
		claimant: string,
		tag?: string,
		among?: ReadonlySet<string>
	): Promise<TaskClaim | null> {
		return this.mutateTasks(tag, async (tasks) => {
			// Read after tasks.json: archive writes archive.json first, so a task
			// is always in one of the two
			const archived = await this.loadArchivedTaskIds(tag);
			const outcome = claimNextInTasks(
				tasks,
				claimant,
				new Date().toISOString(),
				archived,
				{ among }
			);
			return outcome
				? { tasks: outcome.tasks, result: outcome.claim }
				: { tasks: null, result: null };
		});
	}

	/** IDs of the tasks archived in a tag (none without an archive) */
	async loadArchivedTaskIds(tag?: string): Promise<Set<string>> {
		return archivedTaskIds(await this.readArchive(), tag || 'master');
	}

	private async readArchive(): Promise<ArchiveData> {
		try {
			const data = await this.fileOps.readJson(
				this.pathResolver.getArchivePath()
			);
			return data && typeof data === 'object' ? data : {};
		} catch (error: any) {
			if (error.code === 'ENOENT') return {};
			throw error;
		}
	}

	/**
	 * Move finished tasks into archive.json. Locks tasks.json, then
	 * archive.json (restore takes them in the same order), and writes the
	 * archive before tasks.json: if the second write fails the tasks are in
	 * both files, never in neither.
	 */
	async archiveTasks(
		options: ArchiveTasksOptions,
		tag?: string
	): Promise<Task[]> {
		const resolvedTag = tag || 'master';
		if (options.dryRun) {
			return selectArchivable(await this.loadTasks(resolvedTag), options)
				.archive;
		}
		return this.mutateTasks(resolvedTag, async (tasks) => {
			const { archive, keep } = selectArchivable(tasks, options);
			if (archive.length === 0) return { tasks: null, result: [] };
			await this.fileOps.modifyJson(
				this.pathResolver.getArchivePath(),
				(current: ArchiveData) =>
					addToArchive(current ?? {}, resolvedTag, archive, options.now)
			);
			return { tasks: keep, result: archive };
		});
	}

	/**
	 * Move one archived task back into tasks.json. Writes tasks.json before
	 * the archive, for the same reason archiveTasks writes the archive first.
	 */
	async restoreArchivedTask(taskId: string, tag?: string): Promise<Task> {
		const resolvedTag = tag || 'master';
		const id = String(taskId);
		return this.mutateTasks(resolvedTag, async (tasks) => {
			const taken = takeFromArchive(await this.readArchive(), resolvedTag, id);
			if (!taken) {
				throw Object.assign(
					taskNotFound(`Task ${id} isn't archived in tag '${resolvedTag}'`),
					{ hint: 'Archived tasks are in .taskgraph/tasks/archive.json' }
				);
			}
			if (tasks.some((t) => String(t.id) === id)) {
				throw Object.assign(
					new TaskGraphError(
						`Task ${id} is already in tasks.json`,
						ERROR_CODES.VALIDATION_ERROR
					),
					{ hint: `Run \`taskgraph show ${id}\` to see it` }
				);
			}
			return {
				tasks: insertById(tasks, taken.task),
				result: taken.task,
				// Still under the tasks.json lock, so no archive run can interleave
				afterWrite: () =>
					this.fileOps.modifyJson(
						this.pathResolver.getArchivePath(),
						(current: ArchiveData) =>
							takeFromArchive(current ?? {}, resolvedTag, id)?.archive ??
							current
					)
			};
		});
	}

	/**
	 * Change one task or subtask in a single locked read-modify-write
	 */
	async modifyTask(
		taskId: string,
		change: (task: Task | Subtask, isSubtask: boolean) => TaskFieldUpdates,
		tag?: string
	): Promise<Task | Subtask> {
		return this.mutateTasks<Task | Subtask>(tag, (tasks) =>
			modifyTaskIn(tasks, taskId, change)
		);
	}

	/** See IStorage.modifyTasks */
	async modifyTasks<R>(
		change: (tasks: Task[]) => { tasks: Task[] | null; result: R },
		tag?: string
	): Promise<R> {
		return this.mutateTasks(tag, change);
	}

	/**
	 * Delete a task
	 */
	async deleteTask(taskId: string, tag?: string): Promise<void> {
		await this.mutateTasks(tag, (tasks) => {
			const filteredTasks = tasks.filter(
				(t) => String(t.id) !== String(taskId)
			);

			if (filteredTasks.length === tasks.length) {
				throw taskNotFound(`Task ${taskId} not found`);
			}

			return { tasks: filteredTasks, result: undefined };
		});
	}

	/** See TagOperations */
	async createTag(
		tagName: string,
		options?: { copyFrom?: string; description?: string }
	): Promise<number> {
		return this.tagOps.createTag(tagName, options);
	}

	/** See TagOperations */
	async deleteTag(tag: string): Promise<void> {
		return this.tagOps.deleteTag(tag);
	}

	/** See TagOperations */
	async renameTag(oldTag: string, newTag: string): Promise<void> {
		return this.tagOps.renameTag(oldTag, newTag);
	}

	/** See TagOperations */
	async copyTag(
		sourceTag: string,
		targetTag: string,
		options?: { description?: string }
	): Promise<number> {
		return this.tagOps.copyTag(sourceTag, targetTag, options);
	}

	/** See TagOperations */
	async getTagsWithStats(): ReturnType<TagOperations['getTagsWithStats']> {
		return this.tagOps.getTagsWithStats();
	}

	/**
	 * Watch for changes to tasks file
	 * Uses fs.watch with debouncing to detect file changes
	 */
	async watch(
		callback: (event: WatchEvent) => void,
		options?: WatchOptions
	): Promise<WatchSubscription> {
		const tasksPath = this.pathResolver.getTasksPath();
		const debounceMs = options?.debounceMs ?? 100;

		// Ensure file exists before watching
		const fileExists = await this.fileOps.exists(tasksPath);
		if (!fileExists) {
			throw new TaskGraphError(
				'Tasks file not found. Initialize the project first.',
				ERROR_CODES.NOT_FOUND,
				{ path: tasksPath }
			);
		}

		let debounceTimer: NodeJS.Timeout | undefined;
		let closed = false;

		const watcher = fs.watch(tasksPath, (eventType, filename) => {
			if (closed) return;
			if (filename && eventType === 'change') {
				if (debounceTimer) {
					clearTimeout(debounceTimer);
				}
				debounceTimer = setTimeout(() => {
					if (!closed) {
						callback({
							type: 'change',
							timestamp: new Date()
						});
					}
				}, debounceMs);
			}
		});

		watcher.on('error', (error) => {
			if (!closed) {
				callback({
					type: 'error',
					timestamp: new Date(),
					error
				});
			}
		});

		return {
			unsubscribe: () => {
				closed = true;
				if (debounceTimer) {
					clearTimeout(debounceTimer);
				}
				watcher.close();
			}
		};
	}

	/**
	 * Enrich tasks with complexity data from the complexity report
	 * Private helper method called by loadTasks()
	 */
	private async enrichTasksWithComplexity(
		tasks: Task[],
		tag: string
	): Promise<Task[]> {
		// Get all task IDs for bulk lookup
		const taskIds = tasks.map((t) => t.id);

		// Load complexity data for all tasks at once (more efficient)
		const complexityMap = await this.complexityManager.getComplexityForTasks(
			taskIds,
			tag
		);

		// If no complexity data found, return tasks as-is
		if (complexityMap.size === 0) {
			return tasks;
		}

		// Enrich each task with its complexity data
		return tasks.map((task) => {
			const complexityData = complexityMap.get(String(task.id));
			if (!complexityData) {
				return task;
			}

			// Merge complexity data into the task
			return {
				...task,
				complexity: complexityData.complexityScore,
				recommendedSubtasks: complexityData.recommendedSubtasks,
				expansionPrompt: complexityData.expansionPrompt,
				complexityReasoning: complexityData.complexityReasoning
			};
		});
	}
}
