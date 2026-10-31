/**
 * @fileoverview Task edits of the tasks domain that need no AI: archive and
 * restore, progress notes, assignees, and moving tasks and subtasks. TasksDomain
 * exposes each one as `tmCore.tasks.<name>`.
 */

import type { ConfigManager } from '../config/managers/config-manager.js';
import type { TaskService } from './services/task-service.js';
import type { Subtask, Task } from '../../common/types/index.js';
import {
	ERROR_CODES,
	TaskGraphError
} from '../../common/errors/taskgraph-error.js';
import { normalizeAssignee } from './utils/assignee.js';
import type { TaskClaim } from './utils/claim.js';
import { normalizeNoteText, type TaskNote } from './utils/notes.js';
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

/** Archive, notes and restructuring behind TasksDomain */
export class TaskEditCommands {
	constructor(
		private taskService: TaskService,
		private configManager: ConfigManager
	) {}

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

	// ========== Claims and assignees ==========

	/**
	 * Pick the next task nobody has started, set it in-progress and record who
	 * claimed it, in one locked write. Setting it back to pending clears the
	 * claim. `among` limits the pick to those top-level task IDs (one
	 * parallel wave, say). `assignee`, a GitHub login, is given the claimed
	 * task unless someone is assigned to it already.
	 * @returns The claim, or null when no task is ready
	 */
	async claimNext(
		options: {
			tag?: string;
			claimant?: string;
			among?: ReadonlySet<string>;
			assignee?: string;
		} = {}
	): Promise<TaskClaim | null> {
		// A bad login fails before the claim is written
		if (options.assignee) normalizeAssignee(options.assignee);
		const claim = await this.taskService.claimNextTask(
			options.tag,
			options.claimant,
			options.among
		);
		if (!claim || !options.assignee || claim.task.assignee) return claim;
		const { assignee } = await this.assign(
			claim.task.id,
			options.assignee,
			options.tag,
			{ keepExisting: true }
		);
		return { ...claim, task: { ...claim.task, assignee } };
	}

	/**
	 * Assign a task or subtask (`1` or `1.2`) to a GitHub login; an empty
	 * login clears it. Throws INVALID_INPUT for a value that isn't a login.
	 * `keepExisting` leaves an item someone is assigned to alone.
	 * @returns The item as saved
	 */
	assign(
		taskId: string | number,
		login: string,
		tag?: string,
		options: { keepExisting?: boolean } = {}
	): Promise<Task | Subtask> {
		const assignee = normalizeAssignee(login) ?? undefined;
		return this.taskService.modifyTask(
			String(taskId),
			(current) =>
				options.keepExisting && current.assignee ? {} : { assignee },
			tag
		);
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
	 * write. Throws when the parent or task is missing, or the parent is
	 * under or depends on it.
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
}
