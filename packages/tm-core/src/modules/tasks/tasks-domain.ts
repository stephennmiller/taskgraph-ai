/**
 * @fileoverview Tasks Domain Facade
 * Public API for task-related operations
 */

import type { ConfigManager } from '../config/managers/config-manager.js';
import { TaskService } from './services/task-service.js';
import { DependencyService } from './services/dependency.service.js';
import { TaskRemovalService } from './services/task-removal.service.js';
import { TaskAiCommands } from './tasks-ai-commands.js';
import { TaskEditCommands } from './tasks-edit-commands.js';
import { TaskStatusCommands } from './tasks-status-commands.js';
import { TaskDependencyViews } from './tasks-dependency-views.js';
import { TaskDetailReads } from './tasks-detail-reads.js';
import { TaskTagCommands } from './tasks-tag-commands.js';
import {
	TaskFileGeneratorService,
	type GenerateTaskFilesOptions,
	type GenerateTaskFilesResult
} from './services/task-file-generator.service.js';
import type {
	UpdateHooks,
	UpdateTaskInput,
	UpdateTaskResult
} from './services/update-task.service.js';

import fs from 'node:fs';
import path from 'node:path';
import { TASKGRAPH_TASKS_FILE } from '../../common/constants/paths.js';
import type { Subtask, Task, TaskStatus } from '../../common/types/index.js';
import { statusesWhere } from '../../common/constants/index.js';
import {
	type ReadmeExportOptions,
	writeReadmeExport
} from './utils/readme-export.js';
import { parseStatusFilter } from './utils/task-filters.js';
import {
	ERROR_CODES,
	TaskGraphError
} from '../../common/errors/taskgraph-error.js';
import { parseNoteSince } from './utils/notes.js';
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
	WatchEvent,
	WatchOptions,
	WatchSubscription
} from '../../common/interfaces/storage.interface.js';

const PICKABLE_STATUSES = statusesWhere('pickable');

/**
 * Tasks Domain - Unified API for all task operations
 */
export class TasksDomain {
	private taskService: TaskService;
	private tags!: TaskTagCommands;
	private details: TaskDetailReads;
	private dependencyService: DependencyService;
	private removalService: TaskRemovalService;
	private ai: TaskAiCommands;
	private edits: TaskEditCommands;
	private statuses: TaskStatusCommands;
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
			configManager
		);
		this.ai = new TaskAiCommands(this.taskService, configManager);
		this.edits = new TaskEditCommands(this.taskService, configManager);
		this.statuses = new TaskStatusCommands(this.taskService, configManager);
		this.views = new TaskDependencyViews(this.taskService, configManager);
		this.details = new TaskDetailReads(this.taskService, configManager);
	}

	async initialize(): Promise<void> {
		await this.taskService.initialize();

		// TagService needs storage - get it from TaskService AFTER initialization
		this.tags = new TaskTagCommands(this.taskService, this.projectRoot);

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
	 * @throws {TaskGraphError} VALIDATION_ERROR for an unknown status
	 */
	async syncReadme(
		options: ReadmeExportOptions & { tag?: string } = {}
	): Promise<{ readmePath: string }> {
		this.requireTasksFile();
		// A typo would match no task and replace the README's table with an empty one
		parseStatusFilter(options.status);
		const { tasks } = await this.list({ tag: options.tag });
		return {
			readmePath: writeReadmeExport(
				this.configManager.getProjectRoot(),
				tasks,
				{ ...options, projectName: this.configManager.getProjectName() }
			)
		};
	}

	get: TaskDetailReads['get'] = (...a) => this.details.get(...a);

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
	 * Get next available task to work on, skipping what a live claim by
	 * anyone but `claimant` (resolveClaimant() when omitted) holds
	 */
	async getNext(tag?: string, claimant?: string): Promise<Task | null> {
		return this.taskService.getNextTask(tag, claimant);
	}

	claimNext: TaskEditCommands['claimNext'] = (...a) =>
		this.edits.claimNext(...a);
	recordClaimWorker: TaskEditCommands['recordClaimWorker'] = (...a) =>
		this.edits.recordClaimWorker(...a);

	// ===== Dependency views (TaskDependencyViews) =====

	getDependencyTree: TaskDependencyViews['getDependencyTree'] = (...a) =>
		this.views.getDependencyTree(...a);
	analyzeDependencies: TaskDependencyViews['analyzeDependencies'] = (...a) =>
		this.views.analyzeDependencies(...a);
	explainBlockers: TaskDependencyViews['explainBlockers'] = (...a) =>
		this.views.explainBlockers(...a);
	getPrimeContext: TaskDependencyViews['getPrimeContext'] = (...a) =>
		this.views.getPrimeContext(...a);
	getNextSequence: TaskDependencyViews['getNextSequence'] = (...a) =>
		this.views.getNextSequence(...a);

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
	addSpend: TaskEditCommands['addSpend'] = (...a) => this.edits.addSpend(...a);
	assign: TaskEditCommands['assign'] = (...a) => this.edits.assign(...a);
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
	 * How many tasks and subtasks a loop run can still pick: pending or
	 * in-progress, since a resumed run starts on the in-progress one (#1067).
	 * A subtask with no status counts as pending.
	 */
	async getPickableCount(tag?: string): Promise<number> {
		const { tasks } = await this.list({ tag });
		const pickable = (status?: TaskStatus) =>
			!status || PICKABLE_STATUSES.includes(status);
		let count = 0;
		for (const task of tasks) {
			if (pickable(task.status)) count++;
			count += (task.subtasks ?? []).filter((s) => pickable(s.status)).length;
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

	/**
	 * What `update <id>` and the MCP `update_task` tool run: assign the task
	 * (`assignee`, '' clears it), then rewrite it with the AI or merge
	 * `metadata` (`updateWithPrompt`). The assignment comes first, so a bad
	 * login fails before the AI call is paid for. Throws VALIDATION_ERROR
	 * when there is nothing to do. A subtask ID (`3.2`) works only with an
	 * assignee alone.
	 * @returns `assigned` when assigned; `update` unless only assigned
	 */
	async updateTask(
		input: UpdateTaskInput & { assignee?: string },
		hooks: UpdateHooks & { onAssigned?: (item: Task | Subtask) => void } = {}
	): Promise<{ assigned?: Task | Subtask; update?: UpdateTaskResult }> {
		const { assignee, ...rest } = input;
		const hasPrompt = Boolean(rest.prompt?.trim());
		if (!hasPrompt && !rest.metadata && assignee === undefined) {
			throw Object.assign(
				new TaskGraphError(
					'Nothing to update: give a prompt, metadata or an assignee',
					ERROR_CODES.VALIDATION_ERROR
				),
				{ hint: 'Say what changed, or who the task is for' }
			);
		}
		const rewrites = hasPrompt || Boolean(rest.metadata);
		// updateWithPrompt takes only top-level IDs: refuse before assigning
		if (rewrites && String(rest.id).includes('.')) {
			throw Object.assign(
				new TaskGraphError(
					`Task ${rest.id} is a subtask`,
					ERROR_CODES.VALIDATION_ERROR
				),
				{ hint: 'Update subtasks with `taskgraph update-subtask`' }
			);
		}
		let assigned: Task | Subtask | undefined;
		if (assignee !== undefined) {
			assigned = await this.assign(rest.id, assignee, rest.tag);
			hooks.onAssigned?.(assigned);
		}
		if (!rewrites) return { assigned };
		return { assigned, update: await this.updateWithPrompt(rest, hooks) };
	}
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

	// ===== Status changes and their done gates (TaskStatusCommands) =====

	updateStatus: TaskStatusCommands['updateStatus'] = (...a) =>
		this.statuses.updateStatus(...a);
	updateStatuses: TaskStatusCommands['updateStatuses'] = (...a) =>
		this.statuses.updateStatuses(...a);

	// ===== Checklist, commits, PRD section (TaskDetailReads) =====

	getChecklist: TaskDetailReads['getChecklist'] = (...a) =>
		this.details.getChecklist(...a);
	getCommits: TaskDetailReads['getCommits'] = (...a) =>
		this.details.getCommits(...a);
	getPrdSection: TaskDetailReads['getPrdSection'] = (...a) =>
		this.details.getPrdSection(...a);
	loadChecklist: TaskDetailReads['loadChecklist'] = (...a) =>
		this.details.loadChecklist(...a);
	updateChecklist: TaskDetailReads['updateChecklist'] = (...a) =>
		this.details.updateChecklist(...a);

	/**
	 * Set active tag
	 */
	async setActiveTag(tag: string): Promise<void> {
		return this.taskService.setActiveTag(tag);
	}

	// ===== Tag management (TaskTagCommands) =====

	createTag: TaskTagCommands['createTag'] = (...a) => this.tags.createTag(...a);
	createTagFromBranch: TaskTagCommands['createTagFromBranch'] = (...a) =>
		this.tags.createTagFromBranch(...a);
	deleteTag: TaskTagCommands['deleteTag'] = (...a) => this.tags.deleteTag(...a);
	useTag: TaskTagCommands['useTag'] = (...a) => this.tags.useTag(...a);
	renameTag: TaskTagCommands['renameTag'] = (...a) => this.tags.renameTag(...a);
	copyTag: TaskTagCommands['copyTag'] = (...a) => this.tags.copyTag(...a);
	getTagsWithStats: TaskTagCommands['getTagsWithStats'] = (...a) =>
		this.tags.getTagsWithStats(...a);
	listTags: TaskTagCommands['listTags'] = (...a) => this.tags.listTags(...a);

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
