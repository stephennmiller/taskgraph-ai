/**
 * @fileoverview Tasks Domain Facade
 * Public API for task-related operations
 */

import type { ConfigManager } from '../config/managers/config-manager.js';
import { TaskService } from './services/task-service.js';
import { DependencyService } from './services/dependency.service.js';
import { TaskRemovalService } from './services/task-removal.service.js';
import { TagService } from './services/tag.service.js';
import { TaskAiCommands } from './tasks-ai-commands.js';
import { TaskEditCommands } from './tasks-edit-commands.js';
import { TaskDependencyViews } from './tasks-dependency-views.js';
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

import fs from 'node:fs';
import path from 'node:path';
import { TASKGRAPH_TASKS_FILE } from '../../common/constants/paths.js';
import type { Subtask, Task, TaskStatus } from '../../common/types/index.js';
import { readPrdSection } from '../prd/prd-coverage.js';
import { getPrdSource } from '../prd/prd-sections.js';
import type { TaskClaim } from './utils/claim.js';
import { subtaskInContext } from './utils/subtask-context.js';
import {
	type ReadmeExportOptions,
	writeReadmeExport
} from './utils/readme-export.js';
import {
	createTagFromBranch,
	type CreateBranchTag,
	type CreateTagFromBranchResult
} from './utils/branch-tag.js';
import {
	ERROR_CODES,
	TaskGraphError
} from '../../common/errors/taskgraph-error.js';
import { parseNoteSince } from './utils/notes.js';
import {
	applyChecklistChanges,
	buildChecklist,
	checkDoneGate,
	type ChecklistChanges,
	type TaskChecklist
} from './utils/acceptance-criteria.js';
import {
	findUnnotedInProgress,
	type PrimeTask
} from './utils/prime-context.js';
import type {
	TaskListResult,
	GetTaskListOptions
} from './services/task-service.js';
import type {
	TaskFieldUpdates,
	UpdateStatusOptions,
	WatchEvent,
	WatchOptions,
	WatchSubscription
} from '../../common/interfaces/storage.interface.js';

/**
 * Tasks Domain - Unified API for all task operations
 */
export class TasksDomain {
	private taskService: TaskService;
	private tagService!: TagService;
	private dependencyService: DependencyService;
	private removalService: TaskRemovalService;
	private ai: TaskAiCommands;
	private edits: TaskEditCommands;
	private views: TaskDependencyViews;
	private taskFileGenerator!: TaskFileGeneratorService;
	private projectRoot: string;
	private configManager: ConfigManager;

	constructor(configManager: ConfigManager) {
		this.projectRoot = configManager.getProjectRoot();
		this.configManager = configManager;
		this.taskService = new TaskService(configManager);
		this.dependencyService = new DependencyService(
			this.taskService,
			this.projectRoot
		);
		this.removalService = new TaskRemovalService(
			this.taskService,
			this.projectRoot
		);
		this.ai = new TaskAiCommands(this.taskService, configManager);
		this.edits = new TaskEditCommands(this.taskService, configManager);
		this.views = new TaskDependencyViews(this.taskService, configManager);
	}

	async initialize(): Promise<void> {
		await this.taskService.initialize();

		// TagService needs storage - get it from TaskService AFTER initialization
		this.tagService = new TagService(this.taskService.getStorage(), {
			projectRoot: this.projectRoot,
			getActiveTag: () => this.taskService.getActiveTag()
		});

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
	 * Throw NOT_FOUND, naming the path, when the project has no tasks.json.
	 * list() and getNext() read a missing file as no tasks; call this first
	 * where that would hide a wrong project root.
	 */
	requireTasksFile(): void {
		const tasksPath = path.join(
			this.configManager.getProjectRoot(),
			TASKGRAPH_TASKS_FILE
		);
		if (!fs.existsSync(tasksPath)) {
			throw new TaskGraphError(
				`No tasks file at ${tasksPath}`,
				ERROR_CODES.NOT_FOUND
			);
		}
	}

	/**
	 * Write the tag's task list into the project's README.md, between export
	 * markers (replacing an earlier export)
	 */
	async syncReadme(
		options: ReadmeExportOptions & { tag?: string } = {}
	): Promise<{ readmePath: string }> {
		this.requireTasksFile();
		const { tasks } = await this.list({ tag: options.tag });
		return {
			readmePath: writeReadmeExport(
				this.configManager.getProjectRoot(),
				tasks,
				{ ...options, projectName: this.configManager.getProjectName() }
			)
		};
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

	// ===== Dependency views (TaskDependencyViews) =====

	getDependencyTree: TaskDependencyViews['getDependencyTree'] = (...a) =>
		this.views.getDependencyTree(...a);
	analyzeDependencies: TaskDependencyViews['analyzeDependencies'] = (...a) =>
		this.views.analyzeDependencies(...a);
	explainBlockers: TaskDependencyViews['explainBlockers'] = (...a) =>
		this.views.explainBlockers(...a);
	getPrimeContext: TaskDependencyViews['getPrimeContext'] = (...a) =>
		this.views.getPrimeContext(...a);

	// ===== Dependencies and removal (DependencyService, TaskRemovalService) =====

	addDependency: DependencyService['add'] = (...a) =>
		this.dependencyService.add(...a);
	removeDependency: DependencyService['remove'] = (...a) =>
		this.dependencyService.remove(...a);
	validateDependencies: DependencyService['validate'] = (...a) =>
		this.dependencyService.validate(...a);
	fixDependencies: DependencyService['fix'] = (...a) =>
		this.dependencyService.fix(...a);

	previewTaskRemoval: TaskRemovalService['preview'] = (...a) =>
		this.removalService.preview(...a);
	removeTasks: TaskRemovalService['removeTasks'] = (...a) =>
		this.removalService.removeTasks(...a);
	removeSubtasks: TaskRemovalService['removeSubtasks'] = (...a) =>
		this.removalService.removeSubtasks(...a);
	clearSubtasks: TaskRemovalService['clearSubtasks'] = (...a) =>
		this.removalService.clearSubtasks(...a);

	// ===== Archive, notes, restructuring (TaskEditCommands) =====

	archive: TaskEditCommands['archive'] = (...a) => this.edits.archive(...a);
	restore: TaskEditCommands['restore'] = (...a) => this.edits.restore(...a);
	getArchivedIds: TaskEditCommands['getArchivedIds'] = (...a) =>
		this.edits.getArchivedIds(...a);
	addNote: TaskEditCommands['addNote'] = (...a) => this.edits.addNote(...a);
	addSubtask: TaskEditCommands['addSubtask'] = (...a) =>
		this.edits.addSubtask(...a);
	move: TaskEditCommands['move'] = (...a) => this.edits.move(...a);
	moveToTag: TaskEditCommands['moveToTag'] = (...a) =>
		this.edits.moveToTag(...a);

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
					if (
						subtask.status === status ||
						(status === 'pending' && !subtask.status)
					) {
						count++;
					}
				}
			}
		}

		return count;
	}

	// ========== Task Status Management ==========

	/**
	 * Add tasks to a tag (the active tag when omitted) as given, without AI.
	 * A task whose ID is taken gets the next free one; the result holds the
	 * IDs as stored.
	 */
	async append(tasks: Task[], tag?: string): Promise<Task[]> {
		return this.taskService
			.getStorage()
			.appendTasks(tasks, tag || this.configManager.getActiveTag());
	}

	// ===== AI commands (TaskAiCommands, tasks-ai-commands.ts) =====

	analyzeComplexity: TaskAiCommands['analyzeComplexity'] = (...a) =>
		this.ai.analyzeComplexity(...a);
	getComplexityReport: TaskAiCommands['getComplexityReport'] = (...a) =>
		this.ai.getComplexityReport(...a);
	add: TaskAiCommands['add'] = (...a) => this.ai.add(...a);
	expand: TaskAiCommands['expand'] = (...a) => this.ai.expand(...a);
	scope: TaskAiCommands['scope'] = (...a) => this.ai.scope(...a);
	research: TaskAiCommands['research'] = (...a) => this.ai.research(...a);
	updateSubtask: TaskAiCommands['updateSubtask'] = (...a) =>
		this.ai.updateSubtask(...a);
	expandAll: TaskAiCommands['expandAll'] = (...a) => this.ai.expandAll(...a);
	saveResearch: TaskAiCommands['saveResearch'] = (...a) =>
		this.ai.saveResearch(...a);
	updateWithPrompt: TaskAiCommands['updateWithPrompt'] = (...a) =>
		this.ai.updateWithPrompt(...a);
	updateFrom: TaskAiCommands['updateFrom'] = (...a) => this.ai.updateFrom(...a);
	parsePrd: TaskAiCommands['parsePrd'] = (...a) => this.ai.parsePrd(...a);
	parsePrdTarget: TaskAiCommands['parsePrdTarget'] = (...a) =>
		this.ai.parsePrdTarget(...a);
	findPrdGaps: TaskAiCommands['findPrdGaps'] = (...a) =>
		this.ai.findPrdGaps(...a);
	generateObject: TaskAiCommands['generateObject'] = (...a) =>
		this.ai.generateObject(...a);

	/**
	 * Change one task or subtask (`1` or `1.2`) in a single locked
	 * read-modify-write: `change` gets the item as stored now and returns the
	 * fields to set, so a change saved meanwhile isn't overwritten
	 * @returns The item as saved
	 */
	modifyTask(
		taskId: string | number,
		change: (task: Task | Subtask, isSubtask: boolean) => TaskFieldUpdates,
		tag?: string
	): Promise<Task | Subtask> {
		return this.taskService.modifyTask(String(taskId), change, tag);
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
		return this.taskService.updateTaskStatus(
			taskId,
			status,
			tag,
			this.statusWriteOptions(options.force)
		);
	}

	/**
	 * `updateStatus` for several ids in one write: a missing id or a refused
	 * done leaves every id unchanged
	 */
	async updateStatuses(
		taskIds: string[],
		status: TaskStatus,
		tag?: string,
		options: { force?: boolean } = {}
	) {
		return this.taskService.updateTaskStatuses(
			taskIds,
			status,
			tag,
			this.statusWriteOptions(options.force)
		);
	}

	/** The done gate shared by updateStatus and updateStatuses */
	private statusWriteOptions(force?: boolean): UpdateStatusOptions {
		const definitionOfDone = this.configManager.getDefinitionOfDone();
		return {
			guardDone: (task, id, auto) =>
				force && !auto
					? undefined
					: checkDoneGate(task, id, definitionOfDone, id.includes('.'))
		};
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
	 * The PRD section a task cites in `metadata.source`, read from the PRD
	 * verbatim; a subtask without one uses its parent's. Undefined when
	 * neither cites one, or the file or heading is gone.
	 */
	async getPrdSection(
		taskId: string,
		tag?: string
	): Promise<{ source: string; text: string } | undefined> {
		const ids = taskId.includes('.')
			? [taskId, taskId.split('.')[0]]
			: [taskId];
		for (const id of ids) {
			const { task } = await this.get(id, tag);
			const source = task ? getPrdSource(task) : undefined;
			if (!source) continue;
			const text = readPrdSection(source, this.projectRoot);
			return text ? { source, text } : undefined;
		}
		return undefined;
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

	/**
	 * Set active tag
	 */
	async setActiveTag(tag: string): Promise<void> {
		return this.taskService.setActiveTag(tag);
	}

	// ========== Tag Management ==========

	/**
	 * Create a new tag, empty or with a copy of another tag's tasks
	 */
	async createTag(name: string, options?: CreateTagOptions) {
		return this.tagService.createTag(name, options);
	}

	/**
	 * Create a tag named after the current git branch and map the branch to it
	 * in state.json. createTag writes the tag; see createTagFromBranch in
	 * utils/branch-tag.ts for the checks and errors.
	 */
	async createTagFromBranch<T>(
		createTag: CreateBranchTag<T>
	): Promise<CreateTagFromBranchResult<T>> {
		return createTagFromBranch(this.projectRoot, createTag);
	}

	/**
	 * Delete a tag and its tasks; master becomes current if it was.
	 * Cannot delete master.
	 */
	async deleteTag(name: string, options?: DeleteTagOptions) {
		return this.tagService.deleteTag(name, options);
	}

	/**
	 * Make a tag the current one, and find its next task
	 */
	async useTag(name: string) {
		const result = await this.tagService.useTag(name);
		return { ...result, nextTask: await this.getNext(name) };
	}

	/**
	 * Rename a tag, keeping it current if it was. Cannot rename master.
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

	/**
	 * The tags to list, current first, every field filled in (see TagService)
	 * @param options.ready - Only tags with at least one task ready to start
	 */
	async listTags(options: { ready?: boolean } = {}) {
		return this.tagService.listTags(options);
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
