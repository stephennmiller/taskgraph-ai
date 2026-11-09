/**
 * @fileoverview One task in detail, as `show` displays it: the task or
 * subtask by ID, its checklist (acceptance criteria and Definition of Done),
 * its commits and the PRD section it cites. TasksDomain exposes each one as
 * `tmCore.tasks.<name>`.
 */

import type { Subtask, Task, TaskStatus } from '../../common/types/index.js';
import type { ConfigManager } from '../config/managers/config-manager.js';
import { readPrdSection } from '../prd/prd-coverage.js';
import { getPrdSource } from '../prd/prd-sections.js';
import type { TaskService } from './services/task-service.js';
import {
	applyChecklistChanges,
	buildChecklist,
	type ChecklistChanges,
	type TaskChecklist
} from './utils/acceptance-criteria.js';
import { subtaskInContext } from './utils/subtask-context.js';
import { type TaskCommit, findTaskCommits } from './utils/task-commits.js';
import { filterSubtasks, parseStatusFilter } from './utils/task-filters.js';
import { normalizeTaskId } from './validation/task-id.js';

/** Single-task reads and the checklist behind TasksDomain */
export class TaskDetailReads {
	private readonly projectRoot: string;

	constructor(
		private readonly taskService: TaskService,
		private readonly configManager: ConfigManager
	) {
		this.projectRoot = configManager.getProjectRoot();
	}

	/**
	 * Get a single task by ID
	 * Automatically handles all ID formats:
	 * - Simple task IDs (e.g., "1")
	 * - Subtask IDs with dot notation (e.g., "1.2"), returned with their
	 *   parentId and the parent's priority when they have none
	 *
	 * @param options.subtaskStatus - Keep only the task's subtasks with these
	 *   statuses (`done` or `done,pending`, as `list --status` takes them).
	 *   Checked before anything is read: an unknown status throws a
	 *   VALIDATION_ERROR. `subtaskFilter` then gives the statuses kept and the
	 *   number of subtasks before filtering. A subtask ID ignores it.
	 * @returns Discriminated union indicating task/subtask with proper typing
	 */
	async get(
		taskId: string,
		tag?: string,
		options: { subtaskStatus?: string } = {}
	): Promise<
		| {
				task: Task;
				isSubtask: false;
				subtaskFilter?: { statuses: TaskStatus[]; total: number };
		  }
		| { task: Subtask; isSubtask: true }
		| { task: null; isSubtask: boolean }
	> {
		const statuses = parseStatusFilter(options.subtaskStatus);
		// Parse ID - check for dot notation (subtask); "01.03" is 1.3
		const parts = normalizeTaskId(taskId).split('.');
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
		return { ...filterSubtasks(task, statuses), isSubtask: false };
	}

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
	 * The commits whose message names this task or its subtasks in the tag
	 * (`[task <id>]`, `[task <tag>/<id>]` outside master) made since the task
	 * was created, newest first; empty outside git (#954, #1015)
	 */
	async getCommits(taskId: string, tag?: string): Promise<TaskCommit[]> {
		const resolvedTag = tag || this.configManager.getActiveTag();
		const { task } = await this.get(taskId, resolvedTag);
		return findTaskCommits(this.projectRoot, normalizeTaskId(taskId), {
			tag: resolvedTag,
			since: task?.createdAt
		});
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
}
