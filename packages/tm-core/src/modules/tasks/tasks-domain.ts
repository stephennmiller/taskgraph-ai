/**
 * @fileoverview Tasks Domain Facade
 * Public API for task-related operations
 */

import type { ConfigManager } from '../config/managers/config-manager.js';
import { TaskService } from './services/task-service.js';
import { TaskExecutionService } from './services/task-execution-service.js';
import { TaskLoaderService } from './services/task-loader.service.js';
import { PreflightChecker } from './services/preflight-checker.service.js';
import { TagService } from './services/tag.service.js';
import {
	TaskFileGeneratorService,
	type GenerateTaskFilesOptions,
	type GenerateTaskFilesResult
} from './services/task-file-generator.service.js';
import type {
	CreateTagOptions,
	DeleteTagOptions,
	CopyTagOptions
} from './services/tag.service.js';

import type { Subtask, Task, TaskStatus } from '../../common/types/index.js';
import type { TaskClaim } from './utils/claim.js';
import { subtaskInContext } from './utils/subtask-context.js';
import {
	ERROR_CODES,
	TaskGraphError
} from '../../common/errors/taskgraph-error.js';
import {
	appendNote,
	normalizeNoteText,
	parseNoteSince,
	type TaskNote
} from './utils/notes.js';
import {
	applyChecklistChanges,
	buildChecklist,
	checkDoneGate,
	type ChecklistChanges,
	type TaskChecklist
} from './utils/acceptance-criteria.js';
import {
	analyzeDependencies,
	buildDependencyTree,
	explainBlockers,
	type DependencyAnalysis,
	type BlockerExplanation,
	type DependencyTree
} from '../dependencies/index.js';
import {
	buildPrimeContext,
	findUnnotedInProgress,
	type PrimeContext,
	type PrimeTask
} from './utils/prime-context.js';
import type {
	TaskListResult,
	GetTaskListOptions
} from './services/task-service.js';
import type {
	StartTaskOptions,
	StartTaskResult
} from './services/task-execution-service.js';
import type {
	PreflightResult
} from './services/preflight-checker.service.js';
import type { TaskValidationResult } from './services/task-loader.service.js';
import type {
	WatchEvent,
	WatchOptions,
	WatchSubscription
} from '../../common/interfaces/storage.interface.js';

/** What `archive` moved, or would move with dryRun */
export interface ArchiveResult {
	tasks: Task[];
	tag: string;
	olderThanDays: number;
	dryRun: boolean;
}

/**
 * Tasks Domain - Unified API for all task operations
 */
export class TasksDomain {
	private taskService: TaskService;
	private executionService: TaskExecutionService;
	private loaderService: TaskLoaderService;
	private preflightChecker: PreflightChecker;
	private tagService!: TagService;
	private taskFileGenerator!: TaskFileGeneratorService;
	private projectRoot: string;
	private configManager: ConfigManager;

	constructor(configManager: ConfigManager) {
		this.projectRoot = configManager.getProjectRoot();
		this.configManager = configManager;
		this.taskService = new TaskService(configManager);
		this.executionService = new TaskExecutionService(this.taskService);
		this.loaderService = new TaskLoaderService(this.taskService);
		this.preflightChecker = new PreflightChecker(this.projectRoot);
	}

	async initialize(): Promise<void> {
		await this.taskService.initialize();

		// TagService needs storage - get it from TaskService AFTER initialization
		this.tagService = new TagService(this.taskService.getStorage());

		// TaskFileGeneratorService needs storage and config for active tag
		this.taskFileGenerator = new TaskFileGeneratorService(
			this.taskService.getStorage(),
			this.projectRoot,
			this.configManager
		);
	}

	// ========== Task Retrieval ==========

	/**
	 * Get list of tasks with filtering
	 */
	async list(options?: GetTaskListOptions): Promise<TaskListResult> {
		return this.taskService.getTaskList(options);
	}

	/**
	 * Get a single task by ID
	 * Automatically handles all ID formats:
	 * - Simple task IDs (e.g., "1")
	 * - Subtask IDs with dot notation (e.g., "1.2"), returned with their
	 *   parentId and the parent's priority when they have none
	 *
	 * @returns Discriminated union indicating task/subtask with proper typing
	 */
	async get(
		taskId: string,
		tag?: string
	): Promise<
		| { task: Task; isSubtask: false }
		| { task: Subtask; isSubtask: true }
		| { task: null; isSubtask: boolean }
	> {
		// Parse ID - check for dot notation (subtask)
		const parts = taskId.split('.');
		const parentId = parts[0];
		const subtaskIdPart = parts[1];

		// Fetch the task
		const task = await this.taskService.getTask(parentId, tag);
		if (!task) {
			return { task: null, isSubtask: false };
		}

		// Handle subtask notation (1.2)
		if (subtaskIdPart && task.subtasks) {
			const subtask = task.subtasks.find(
				(st) => String(st.id) === subtaskIdPart
			);
			if (subtask) {
				return { task: subtaskInContext(task, subtask), isSubtask: true };
			}
			// Subtask ID provided but not found
			return { task: null, isSubtask: true };
		}

		// It's a regular task
		return { task, isSubtask: false };
	}

	/**
	 * Get tasks by status
	 */
	async getByStatus(status: TaskStatus, tag?: string): Promise<Task[]> {
		return this.taskService.getTasksByStatus(status, tag);
	}

	/**
	 * Get task statistics
	 */
	async getStats(tag?: string) {
		return this.taskService.getTaskStats(tag);
	}

	/**
	 * Get next available task to work on
	 */
	async getNext(tag?: string): Promise<Task | null> {
		return this.taskService.getNextTask(tag);
	}

	/**
	 * Pick the next task nobody has started, set it in-progress and record who
	 * claimed it, in one locked write. Setting it back to pending clears the
	 * claim. `among` limits the pick to those top-level task IDs (one
	 * parallel wave, say).
	 * @returns The claim, or null when no task is ready
	 */
	async claimNext(
		options: {
			tag?: string;
			claimant?: string;
			among?: ReadonlySet<string>;
		} = {}
	): Promise<TaskClaim | null> {
		return this.taskService.claimNextTask(
			options.tag,
			options.claimant,
			options.among
		);
	}

	/**
	 * Lay tasks out as a dependency tree for display (each task once, under
	 * its deepest dependency). Pass rootId for one task and what depends on it.
	 * Throws NOT_FOUND for a tag the project doesn't have.
	 */
	async getDependencyTree(
		options: { tag?: string; rootId?: string } = {}
	): Promise<DependencyTree> {
		const tasks = await this.taskService.getDependencyView(options.tag);
		return buildDependencyTree(tasks, { rootId: options.rootId });
	}

	/**
	 * Bottlenecks (top 5 unless limit is set), critical path and dependency
	 * cycles for a tag's tasks. With taskId, also explains what blocks that
	 * task (see explainBlockers) from the same task list. Throws NOT_FOUND for
	 * a tag the project doesn't have.
	 */
	async analyzeDependencies(
		options: { tag?: string; limit?: number; taskId?: string } = {}
	): Promise<DependencyAnalysis> {
		const tasks = await this.taskService.getDependencyView(options.tag);
		return analyzeDependencies(tasks, {
			limit: options.limit,
			id: options.taskId
		});
	}

	/**
	 * Explain why a task can't be started: its unfinished dependencies, down
	 * to the root causes (ready work, stalled tasks, missing IDs, cycles).
	 * Works for subtask IDs like "2.1"; a subtask also waits on its parent's
	 * dependencies. Throws if the task or the named tag doesn't exist.
	 */
	async explainBlockers(
		taskId: string,
		options: { tag?: string } = {}
	): Promise<BlockerExplanation> {
		const tasks = await this.taskService.getDependencyView(options.tag);
		return explainBlockers(tasks, String(taskId));
	}

	/**
	 * Session context for a coding agent (`taskgraph prime`): the task in
	 * progress with its done-when criteria, the next three ready tasks in
	 * `next` order, and the workflow rules. Uses the active tag by default.
	 */
	async getPrimeContext(options: { tag?: string } = {}): Promise<PrimeContext> {
		const tag = options.tag || this.configManager.getActiveTag();
		const tasks = await this.taskService.getDependencyView(tag);
		return buildPrimeContext(tasks, { tag });
	}

	// ========== Archive ==========

	/**
	 * Move done and cancelled tasks out of tasks.json into
	 * .taskgraph/tasks/archive.json, in one locked write. A task qualifies
	 * when its last change is at least `olderThanDays` old (default: config
	 * `global.archiveAfterDays`, else 30); one with no timestamp qualifies.
	 * Archived IDs are never reused, and dependencies on them count as done.
	 * @returns The tasks archived (or that would be, with dryRun)
	 */
	async archive(
		options: { tag?: string; olderThanDays?: number; dryRun?: boolean } = {}
	): Promise<ArchiveResult> {
		const olderThanDays =
			options.olderThanDays ?? this.configManager.getArchiveAfterDays();
		if (!Number.isInteger(olderThanDays) || olderThanDays < 0) {
			throw new TaskGraphError(
				`"${olderThanDays}" isn't a number of days`,
				ERROR_CODES.INVALID_INPUT
			);
		}
		const tag = options.tag || this.configManager.getActiveTag();
		const tasks = await this.taskService.archiveTasks(
			{ olderThanDays, dryRun: options.dryRun },
			tag
		);
		return { tasks, tag, olderThanDays, dryRun: options.dryRun === true };
	}

	/**
	 * Move one archived task, with its subtasks, back into tasks.json
	 * @param taskId - A task ID like "5" (subtasks come back with their task)
	 */
	async restore(
		taskId: string,
		options: { tag?: string } = {}
	): Promise<{ task: Task; tag: string }> {
		const id = String(taskId).trim();
		if (id.includes('.')) {
			throw Object.assign(
				new TaskGraphError(
					`${id} is a subtask; restore its task instead`,
					ERROR_CODES.INVALID_INPUT
				),
				{ hint: `Run \`taskgraph archive restore ${id.split('.')[0]}\`` }
			);
		}
		const tag = options.tag || this.configManager.getActiveTag();
		const task = await this.taskService.restoreArchivedTask(id, tag);
		return { task, tag };
	}

	/**
	 * IDs of the tasks archived in a tag (the active tag when omitted)
	 */
	async getArchivedIds(tag?: string): Promise<Set<string>> {
		return this.taskService.getArchivedTaskIds(tag);
	}

	/**
	 * In-progress tasks and subtasks with no note added at or after `since`
	 * (an ISO time). Throws INVALID_INPUT when `since` isn't a time.
	 */
	async getUnnotedInProgress(options: {
		since: string;
		tag?: string;
	}): Promise<PrimeTask[]> {
		const since = parseNoteSince(options.since);
		const tag = options.tag || this.configManager.getActiveTag();
		const { tasks } = await this.list({ tag });
		return findUnnotedInProgress(tasks, since);
	}

	/**
	 * Get count of tasks and their subtasks matching a status
	 * Useful for determining work remaining, progress tracking, or setting loop iterations
	 *
	 * @param status - Task status to count (e.g., 'pending', 'done', 'in-progress')
	 * @param tag - Optional tag to filter tasks
	 * @returns Total count of matching tasks + matching subtasks
	 */
	async getCount(status: TaskStatus, tag?: string): Promise<number> {
		// Fetch ALL tasks to ensure we count subtasks across all parent tasks
		// (a parent task may have different status than its subtasks)
		const result = await this.list({ tag });

		let count = 0;
		for (const task of result.tasks) {
			// Count the task if it matches the status
			if (task.status === status) {
				count++;
			}

			// Count subtasks with matching status
			if (task.subtasks && task.subtasks.length > 0) {
				for (const subtask of task.subtasks) {
					// For pending, also count subtasks without status (default to pending)
					if (subtask.status === status || (status === 'pending' && !subtask.status)) {
						count++;
					}
				}
			}
		}

		return count;
	}

	// ========== Task Status Management ==========

	/**
	 * Update task with new data (direct structural update)
	 * @param taskId - Task ID (supports numeric, alphanumeric like TAS-49, and subtask IDs like 1.2)
	 * @param updates - Partial task object with fields to update
	 * @param tag - Optional tag context
	 */
	async update(
		taskId: string | number,
		updates: Partial<Task>,
		tag?: string
	): Promise<void> {
		return this.taskService.updateTask(taskId, updates, tag);
	}

	/**
	 * Update task status.
	 *
	 * Moving a task to done is refused while its checklist (its acceptance
	 * criteria, plus the project's Definition of Done for a top-level task)
	 * has unchecked items: the error has code CRITERIA_UNCHECKED, and
	 * `getUncheckedCriteria(error)` lists them. `force` skips that check.
	 * A parent whose last subtask finishes stays in progress until its own
	 * checklist is clear, even with `force`.
	 */
	async updateStatus(
		taskId: string,
		status: TaskStatus,
		tag?: string,
		options: { force?: boolean } = {}
	) {
		const definitionOfDone = this.configManager.getDefinitionOfDone();
		return this.taskService.updateTaskStatus(taskId, status, tag, {
			guardDone: (task, id, auto) =>
				options.force && !auto
					? undefined
					: checkDoneGate(task, id, definitionOfDone, id.includes('.'))
		});
	}

	// ========== Acceptance Criteria ==========

	/**
	 * A task's checklist: its acceptance criteria, numbered from 1, then the
	 * project's Definition of Done (top-level tasks only)
	 */
	getChecklist(task: Task | Subtask, isSubtask = false): TaskChecklist {
		return buildChecklist(
			task,
			this.configManager.getDefinitionOfDone(),
			isSubtask
		);
	}

	/**
	 * A task or subtask's checklist as stored, by ID ("3" or "3.2"); undefined
	 * when there is no such task. Use this rather than `getChecklist` for a
	 * task from `list` or `getNext`, which leave the criteria fields out.
	 */
	async loadChecklist(
		taskId: string,
		tag?: string
	): Promise<TaskChecklist | undefined> {
		const { task, isSubtask } = await this.get(taskId, tag);
		return task ? this.getChecklist(task, isSubtask) : undefined;
	}

	/**
	 * Check and uncheck checklist items by number, in one write.
	 * Throws INVALID_INPUT, changing nothing, for a number the task's
	 * checklist doesn't have.
	 *
	 * @returns The checklist as saved
	 */
	async updateChecklist(
		taskId: string,
		changes: ChecklistChanges,
		tag?: string
	): Promise<TaskChecklist> {
		const definitionOfDone = this.configManager.getDefinitionOfDone();
		const saved = await this.taskService.modifyTask(
			taskId,
			(task, isSubtask) =>
				applyChecklistChanges(
					task,
					taskId,
					definitionOfDone,
					changes,
					isSubtask
				),
			tag
		);
		return buildChecklist(saved, definitionOfDone, taskId.includes('.'));
	}

	// ========== Notes ==========

	/**
	 * Append a progress note to a task or subtask's details, as written and
	 * timestamped, in one locked write that changes only that item. No AI
	 * call: use update-subtask/update-task for an AI rewrite.
	 * Throws INVALID_INPUT for an empty note (before touching the file) and
	 * TASK_NOT_FOUND for an unknown ID.
	 */
	async addNote(
		taskId: string,
		text: string,
		options: { tag?: string } = {}
	): Promise<TaskNote> {
		const note = normalizeNoteText(text);
		const id = String(taskId).trim();
		const addedAt = new Date().toISOString();
		const saved = await this.taskService.modifyTask(
			id,
			(task) => ({ details: appendNote(task.details, note, addedAt) }),
			options.tag
		);
		return {
			id,
			title: saved.title,
			isSubtask: id.includes('.'),
			addedAt,
			text: note
		};
	}

	/**
	 * Set active tag
	 */
	async setActiveTag(tag: string): Promise<void> {
		return this.taskService.setActiveTag(tag);
	}

	// ========== Task Execution ==========

	/**
	 * Start working on a task
	 */
	async start(taskId: string, options?: StartTaskOptions): Promise<StartTaskResult> {
		return this.executionService.startTask(taskId, options);
	}

	/**
	 * Check for in-progress conflicts
	 */
	async checkInProgressConflicts(taskId: string) {
		return this.executionService.checkInProgressConflicts(taskId);
	}

	/**
	 * Get next available task (from execution service)
	 */
	async getNextAvailable(): Promise<string | null> {
		return this.executionService.getNextAvailableTask();
	}

	/**
	 * Check if a task can be started
	 */
	async canStart(taskId: string, force?: boolean): Promise<boolean> {
		return this.executionService.canStartTask(taskId, force);
	}

	// ========== Task Loading & Validation ==========

	/**
	 * Load and validate a task for execution
	 */
	async loadAndValidate(taskId: string): Promise<TaskValidationResult> {
		return this.loaderService.loadAndValidateTask(taskId);
	}

	/**
	 * Get execution order for subtasks
	 */
	getExecutionOrder(task: Task) {
		return this.loaderService.getExecutionOrder(task);
	}

	// ========== Preflight Checks ==========

	/**
	 * Run all preflight checks
	 */
	async runPreflightChecks(): Promise<PreflightResult> {
		return this.preflightChecker.runAllChecks();
	}

	/**
	 * Detect test command
	 */
	async detectTestCommand() {
		return this.preflightChecker.detectTestCommand();
	}

	/**
	 * Check git working tree
	 */
	async checkGitWorkingTree() {
		return this.preflightChecker.checkGitWorkingTree();
	}

	/**
	 * Validate required tools
	 */
	async validateRequiredTools() {
		return this.preflightChecker.validateRequiredTools();
	}

	/**
	 * Detect default git branch
	 */
	async detectDefaultBranch() {
		return this.preflightChecker.detectDefaultBranch();
	}

	// ========== Tag Management ==========

	/**
	 * Create a new tag, with optional task copying
	 */
	async createTag(name: string, options?: CreateTagOptions) {
		return this.tagService.createTag(name, options);
	}

	/**
	 * Delete an existing tag
	 * Cannot delete master tag
	 */
	async deleteTag(name: string, options?: DeleteTagOptions) {
		return this.tagService.deleteTag(name, options);
	}

	/**
	 * Rename an existing tag
	 * Cannot rename master tag
	 */
	async renameTag(oldName: string, newName: string) {
		return this.tagService.renameTag(oldName, newName);
	}

	/**
	 * Copy an existing tag to create a new tag with the same tasks
	 */
	async copyTag(source: string, target: string, options?: CopyTagOptions) {
		return this.tagService.copyTag(source, target, options);
	}

	/**
	 * Get all tags with detailed statistics including task counts
	 * @param options.ready - Only tags with at least one task ready to start
	 */
	async getTagsWithStats(options: { ready?: boolean } = {}) {
		const result = await this.tagService.getTagsWithStats();
		if (!options.ready) return result;
		const tags = result.tags.filter((tag) => tag.readyTasks > 0);
		return { ...result, tags, totalTags: tags.length };
	}

	// ========== Watch ==========

	/**
	 * Watch for changes to tasks
	 * Uses fs.watch on tasks.json with debouncing
	 *
	 * @param callback - Function called when tasks change
	 * @param options - Watch options (debounce, tag)
	 * @returns Subscription handle with unsubscribe method
	 */
	async watch(
		callback: (event: WatchEvent) => void,
		options?: WatchOptions
	): Promise<WatchSubscription> {
		const storage = this.taskService.getStorage();
		return storage.watch(callback, options);
	}

	// ========== Task File Generation ==========

	/**
	 * Generate individual task markdown files from tasks.json
	 * This writes .md files for each task in the tasks directory.
	 *
	 * @param options - Generation options (tag, outputDir)
	 * @returns Result with count of generated files and cleanup info
	 */
	async generateTaskFiles(
		options?: GenerateTaskFilesOptions
	): Promise<GenerateTaskFilesResult> {
		return this.taskFileGenerator.generateTaskFiles(options);
	}

	// ========== Cleanup ==========

	/**
	 * Close and cleanup resources
	 * Releases file locks and other storage resources
	 */
	async close(): Promise<void> {
		await this.taskService.close();
	}
}
