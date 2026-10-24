/**
 * @fileoverview Tasks Domain Facade
 * Public API for task-related operations
 */

import type { ConfigManager } from '../config/managers/config-manager.js';
import { TaskService } from './services/task-service.js';
import { DependencyService } from './services/dependency.service.js';
import { TaskRemovalService } from './services/task-removal.service.js';
import { TagService } from './services/tag.service.js';
import {
	AnalyzeComplexityService,
	type AnalyzeComplexityHooks,
	type AnalyzeComplexityInput,
	type AnalyzeComplexityResult,
	type ComplexityReportFile,
	readComplexityReport
} from './services/analyze-complexity.service.js';
import {
	AddTaskService,
	type AddTaskHooks,
	type AddTaskInput,
	type AddTaskResult
} from './services/add-task.service.js';
import {
	ExpandTaskService,
	type ExpandAllHooks,
	type ExpandAllResult,
	type ExpandOptions,
	type ExpandTaskHooks,
	type ExpandTaskInput,
	type ExpandTaskResult
} from './services/expand-task.service.js';
import {
	ResearchService,
	type ResearchExchange,
	type ResearchHooks,
	type ResearchInput,
	type ResearchResult,
	type ResearchSaved
} from './services/research.service.js';
import {
	type UpdateSubtaskHooks,
	type UpdateSubtaskInput,
	type UpdateSubtaskResult,
	UpdateSubtaskService
} from './services/update-subtask.service.js';
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
	createTagFromBranch,
	type CreateBranchTag,
	type CreateTagFromBranchResult
} from './utils/branch-tag.js';
import {
	ERROR_CODES,
	TaskGraphError
} from '../../common/errors/taskgraph-error.js';
import {
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
	WatchEvent,
	WatchOptions,
	WatchSubscription
} from '../../common/interfaces/storage.interface.js';
import {
	type AddSubtaskInput,
	addSubtaskToTag,
	moveTasksToTag,
	moveTasksWithinTag
} from './services/task-restructure.js';
import type {
	CrossTagMoveOptions,
	CrossTagMoveResult,
	WithinTagMoveResult
} from './utils/task-moves.js';

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
	private tagService!: TagService;
	private dependencyService: DependencyService;
	private removalService: TaskRemovalService;
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

	/**
	 * Session context for a coding agent (`taskgraph prime`): the task in
	 * progress with its done-when criteria, the next three ready tasks in
	 * `next` order, and the workflow rules. Uses the active tag by default.
	 * An active tag tasks.json doesn't have gives an empty context with
	 * `tagMissing`, so session start still gets the rules.
	 */
	async getPrimeContext(options: { tag?: string } = {}): Promise<PrimeContext> {
		const activeTag = this.configManager.getActiveTag();
		const tag = options.tag || activeTag;
		if (tag === activeTag && !(await this.taskService.tagExists(tag))) {
			return { ...buildPrimeContext([], { tag }), tagMissing: true };
		}
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
	 * Add tasks to a tag (the active tag when omitted) as given, without AI.
	 * A task whose ID is taken gets the next free one; the result holds the
	 * IDs as stored.
	 */
	async append(tasks: Task[], tag?: string): Promise<Task[]> {
		return this.taskService
			.getStorage()
			.appendTasks(tasks, tag || this.configManager.getActiveTag());
	}

	/**
	 * Score the tag's active tasks (pending, blocked, in-progress), or those
	 * named by `ids` or the `from`-`to` range, and save them to the tag's
	 * complexity report. Entries for the tag's other tasks stay in the report.
	 */
	async analyzeComplexity(
		input: AnalyzeComplexityInput = {},
		hooks?: AnalyzeComplexityHooks
	): Promise<AnalyzeComplexityResult> {
		return new AnalyzeComplexityService(this.configManager).analyze(
			input,
			hooks
		);
	}

	/**
	 * The tag's complexity report, or `file` (relative to the project root).
	 * Null when there is none.
	 */
	getComplexityReport(
		options: { tag?: string; file?: string } = {}
	): { report: ComplexityReportFile; reportPath: string } | null {
		return readComplexityReport(this.configManager.getProjectRoot(), {
			tag: options.tag || this.configManager.getActiveTag(),
			file: options.file
		});
	}

	/**
	 * Add one task: written by the AI from `prompt`, or given as `title` and
	 * `description` (no AI call). The AI call runs without the file lock; the
	 * save re-reads tasks.json under it and appends only the new task, with
	 * an ID free at that moment. Dependencies that don't exist in the tag are
	 * dropped with a warning; an unknown `discoveredFrom` throws before any AI call.
	 */
	async add(
		input: AddTaskInput,
		hooks?: AddTaskHooks
	): Promise<AddTaskResult> {
		return new AddTaskService(
			() => this.taskService.getStorage(),
			this.configManager
		).add(input, hooks);
	}

	/**
	 * Expand a top-level task into subtasks with the AI. The count and prompt
	 * come from `num`, else the complexity report, else defaultSubtasks; a
	 * report count of 0 skips the task without an AI call. New subtasks are
	 * added, or with `force` replace the old ones. The AI call runs without
	 * the file lock; the save changes only this task's subtasks.
	 */
	async expand(
		input: ExpandTaskInput,
		hooks?: ExpandTaskHooks
	): Promise<ExpandTaskResult> {
		return new ExpandTaskService(this.taskService, this.configManager).expand(
			input,
			hooks
		);
	}

	/**
	 * Ask the research model a question with project context: the tasks you
	 * name plus the ones matching the question, files inside the project
	 * (never secrets), the project tree and your notes. Task IDs and files
	 * are checked before the AI call. saveTo appends the answer to a task's
	 * details in one locked write; a save that fails is reported in
	 * `saveFailures`, and the answer is kept.
	 */
	async research(
		input: ResearchInput,
		hooks?: ResearchHooks
	): Promise<ResearchResult> {
		return new ResearchService(this.taskService, this.configManager).research(
			input,
			hooks
		);
	}

	/**
	 * Have the AI write notes for a subtask ("5.2") from a prompt, appended
	 * to its details as a timestamped block; `metadata` alone skips the AI.
	 * The AI call runs without the file lock; the save changes only that
	 * subtask, and an empty answer saves no notes.
	 */
	async updateSubtask(
		input: UpdateSubtaskInput,
		hooks?: UpdateSubtaskHooks
	): Promise<UpdateSubtaskResult> {
		return new UpdateSubtaskService(
			this.taskService,
			this.configManager
		).updateSubtask(input, hooks);
	}

	/**
	 * Expand every pending or in-progress task that has no subtasks (any,
	 * with `force`), three at a time. Failures are counted, not thrown.
	 */
	async expandAll(
		options: ExpandOptions,
		hooks?: ExpandAllHooks
	): Promise<ExpandAllResult> {
		return new ExpandTaskService(
			this.taskService,
			this.configManager
		).expandAll(options, hooks);
	}

	/**
	 * Save a research conversation to a task's details (one locked write) or
	 * to .taskgraph/docs/research/
	 */
	async saveResearch(
		history: ResearchExchange[],
		target: { taskId: string } | { file: true },
		tag?: string
	): Promise<ResearchSaved> {
		return new ResearchService(
			this.taskService,
			this.configManager
		).saveResearch(history, target, tag);
	}

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
		const { saved, addedAt } = await this.taskService.appendToDetails(
			id,
			note,
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

	// ========== Restructuring ==========

	/**
	 * Add a subtask to `parentId`, or with `fromTaskId` turn that task into
	 * one (what depended on it then depends on the subtask), in one locked
	 * write. Throws when the parent or task is missing, the task is already
	 * a subtask, or the parent depends on it.
	 */
	async addSubtask(
		parentId: string,
		input: AddSubtaskInput,
		options: { tag?: string } = {}
	): Promise<{ subtask: Subtask; tag: string }> {
		const tag = options.tag || this.configManager.getActiveTag();
		const storage = this.taskService.getStorage();
		const subtask = await addSubtaskToTag(storage, tag, parentId, input);
		return { subtask, tag };
	}

	/**
	 * Move tasks or subtasks to new IDs within a tag, in one locked write:
	 * `from` and `to` are one ID each ("5", "5.2") or as many
	 * comma-separated. Nothing moves if any pair fails.
	 */
	async move(
		from: string,
		to: string,
		options: { tag?: string } = {}
	): Promise<WithinTagMoveResult & { tag: string }> {
		const tag = options.tag || this.configManager.getActiveTag();
		const storage = this.taskService.getStorage();
		return { ...(await moveTasksWithinTag(storage, tag, from, to)), tag };
	}

	/**
	 * Move tasks, with their subtasks, to another tag (created if missing),
	 * keeping their IDs, in one locked write. Dependencies left in the source
	 * tag block the move unless `withDependencies` or `ignoreDependencies`.
	 */
	async moveToTag(
		taskIds: string[],
		fromTag: string,
		toTag: string,
		options: CrossTagMoveOptions = {}
	): Promise<CrossTagMoveResult> {
		const storage = this.taskService.getStorage();
		return moveTasksToTag(storage, taskIds, fromTag, toTag, options);
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
