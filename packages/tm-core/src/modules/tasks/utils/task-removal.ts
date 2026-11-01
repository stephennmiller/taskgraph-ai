/**
 * @fileoverview remove-task, remove-subtask and clear-subtasks on a tag's
 * tasks as stored. Each changes `tasks` in place and leaves nothing pointing
 * at what it removed (dropReferences). Every ID is checked before anything
 * changes, so a list with a bad ID changes nothing.
 */

import type { Subtask, Task } from '../../../common/types/index.js';
import {
	ERROR_CODES,
	errorWithHint
} from '../../../common/errors/taskgraph-error.js';
import { validateTaskDependencies } from '../../dependencies/dependency-check.js';
import { assignMetadata } from '../../dependencies/dependency-provenance.js';
import {
	dropReferences,
	removeAllSubtasks
} from '../../dependencies/removed-references.js';
import { pruneTaskLinks } from '../../dependencies/task-links.js';
import {
	dependenciesForMovedItem,
	retargetDependents
} from '../../dependencies/task-to-subtask.js';
import {
	canonicalTaskId,
	fullSubtaskId,
	normalizeTaskId
} from '../validation/task-id.js';
import { liveOrArchived, nextTaskId } from './archive.js';
import { promotedSubtaskDescription } from './promoted-subtask.js';

type StoredSubtask = Subtask & Record<string, unknown>;

/** Comma-separated IDs, trimmed, without empty entries */
export function splitIds(ids: string): string[] {
	return ids
		.split(',')
		.map((id) => id.trim())
		.filter(Boolean);
}

/** A task or subtask an ID names; `3` and `03` are task 3 */
function findItem(
	tasks: Task[],
	id: string
): { task: Task; subtask?: StoredSubtask } | undefined {
	// "2.", "2x" or "2.1.1" names nothing; parseInt read them as task 2 or 2.1
	const fullId = canonicalTaskId(id);
	if (fullId === undefined) return undefined;
	const [parentId, subtaskId] = fullId.split('.');
	const task = tasks.find((t) => String(t.id) === parentId);
	if (subtaskId === undefined) return task && { task };
	const subtask = (task?.subtasks ?? []).find(
		(st) => fullSubtaskId(task!.id, st.id) === fullId
	);
	return task && subtask
		? { task, subtask: subtask as StoredSubtask }
		: undefined;
}

// ========== remove-task ==========

/** What remove-task would remove, for its confirmation prompt */
export interface TaskRemovalPreview {
	/** The IDs that exist, as given, with what they name */
	found: Array<{
		id: string;
		title: string;
		/** Set for a subtask */
		parent?: { id: string; title: string };
	}>;
	/** The IDs that name nothing */
	missing: string[];
	/** Subtasks that go with the tasks */
	subtaskCount: number;
	/** For each task, the tasks that depend on it */
	dependents: Array<{ id: string; dependentIds: string[] }>;
}

export function previewTaskRemoval(
	tasks: Task[],
	ids: string[]
): TaskRemovalPreview {
	const preview: TaskRemovalPreview = {
		found: [],
		missing: [],
		subtaskCount: 0,
		dependents: []
	};
	for (const id of ids) {
		const item = findItem(tasks, id);
		if (!item) {
			preview.missing.push(id);
			continue;
		}
		if (item.subtask) {
			preview.found.push({
				id,
				title: item.subtask.title,
				parent: { id: String(item.task.id), title: item.task.title }
			});
			continue;
		}
		preview.found.push({ id, title: item.task.title });
		preview.subtaskCount += item.task.subtasks?.length ?? 0;
		const dependentIds = tasks
			.filter((t) =>
				t.dependencies?.some((d) => String(d) === String(item.task.id))
			)
			.map((t) => String(t.id));
		if (dependentIds.length > 0) preview.dependents.push({ id, dependentIds });
	}
	return preview;
}

export interface RemoveTasksOutcome {
	/** The removed tasks as stored; a subtask also has `parentTaskId` */
	removedTasks: Array<Task | (StoredSubtask & { parentTaskId: number })>;
	/** One line per removed ID */
	messages: string[];
	/** Top-level task numbers removed, whose task files go too */
	removedTaskNumbers: number[];
	/** Tasks and subtasks left that still depend on a missing task */
	danglingDependents: number;
}

/**
 * Remove tasks and subtasks, their subtasks with them, and every reference
 * to them. Throws, changing nothing, when an ID names nothing.
 */
export function removeTasksIn(
	tasks: Task[],
	ids: string[],
	tag: string,
	archivedIds: ReadonlySet<string>
): RemoveTasksOutcome {
	if (ids.length === 0) {
		throw errorWithHint(ERROR_CODES.INVALID_INPUT, 'Task ID is required');
	}
	const missing = ids.filter((id) => !findItem(tasks, id));
	if (missing.length > 0) {
		throw errorWithHint(
			ERROR_CODES.TASK_NOT_FOUND,
			`The following tasks were not found in tag '${tag}': ${missing.join(', ')}`
		);
	}

	const outcome: RemoveTasksOutcome = {
		removedTasks: [],
		messages: [],
		removedTaskNumbers: [],
		danglingDependents: 0
	};
	const removedIds = new Set<string>();
	for (const id of ids) {
		// Gone already: listed twice, or a subtask of a task removed before it
		const item = findItem(tasks, id);
		if (!item) continue;
		if (item.subtask) {
			const subtasks = item.task.subtasks as StoredSubtask[];
			subtasks.splice(subtasks.indexOf(item.subtask), 1);
			outcome.removedTasks.push({
				...item.subtask,
				parentTaskId: parseInt(id, 10)
			});
			removedIds.add(fullSubtaskId(item.task.id, item.subtask.id));
			outcome.messages.push(
				`Successfully removed subtask ${id} from tag '${tag}'`
			);
			continue;
		}
		tasks.splice(tasks.indexOf(item.task), 1);
		outcome.removedTasks.push(item.task);
		outcome.removedTaskNumbers.push(parseInt(id, 10));
		removedIds.add(String(parseInt(id, 10)));
		// A removed task's subtasks go with it, so references to them do too
		for (const subtask of item.task.subtasks ?? []) {
			removedIds.add(fullSubtaskId(item.task.id, subtask.id));
		}
		outcome.messages.push(`Successfully removed task ${id} from tag '${tag}'`);
	}
	dropReferences(tasks, removedIds);

	// Dependencies that were already dangling stay; callers point to
	// fix-dependencies. A failed check must not fail the removal.
	try {
		const { issues } = validateTaskDependencies(tasks, archivedIds);
		outcome.danglingDependents = new Set(
			issues
				.filter((issue) => issue.type === 'missing')
				.map((issue) => String(issue.taskId))
		).size;
	} catch {
		// counted as none
	}
	return outcome;
}

// ========== remove-subtask ==========

interface RemoveSubtaskOptions {
	convert?: boolean;
	/** The archive's highest ID for the tag; a new task's ID goes above it */
	highestArchivedId: number;
	archivedIds: ReadonlySet<string>;
}

/**
 * Remove subtasks ("5.2"), or with `convert` turn each into a top-level task
 * with the subtask's own dependencies (not its old parent). Throws, changing nothing, when an ID isn't
 * a subtask that exists.
 * @returns For each ID, the task it became, or null when it was deleted
 */
export function removeSubtasksIn(
	tasks: Task[],
	ids: string[],
	options: RemoveSubtaskOptions
): Array<Task | null> {
	return ids.map((id) => removeSubtaskIn(tasks, id, options));
}

function removeSubtaskIn(
	tasks: Task[],
	id: string,
	{ convert, highestArchivedId, archivedIds }: RemoveSubtaskOptions
): Task | null {
	// Exactly "<task>.<subtask>": parseInt read "1.1x" as 1.1 (#539)
	if (!/^\d+\.\d+$/.test(id)) {
		throw errorWithHint(
			ERROR_CODES.INVALID_INPUT,
			`Invalid subtask ID format: ${id}. Expected format: "parentId.subtaskId"`
		);
	}
	const [parentIdStr, subtaskIdStr] = id.split('.');
	const parentId = parseInt(parentIdStr, 10);
	const subtaskNumber = parseInt(subtaskIdStr, 10);
	const parent = tasks.find((t) => String(t.id) === String(parentId));
	if (!parent) {
		throw errorWithHint(
			ERROR_CODES.TASK_NOT_FOUND,
			`Task ${parentId} not found, so subtask ${id} doesn't exist`
		);
	}
	const index = (parent.subtasks ?? []).findIndex(
		(st) => String(st.id) === String(subtaskNumber)
	);
	if (index === -1) {
		throw errorWithHint(
			ERROR_CODES.TASK_NOT_FOUND,
			`Subtask ${id} not found`,
			`Run \`taskgraph show ${parentId}\` to see its subtasks`
		);
	}

	const subtasks = parent.subtasks as StoredSubtask[];
	const [removed] = subtasks.splice(index, 1);
	// Saved without the key, as the legacy command did
	if (subtasks.length === 0) delete (parent as Partial<Task>).subtasks;
	const fullId = `${parentId}.${subtaskNumber}`;

	if (!convert) {
		// Dependencies on it, their marks and links to it go with it
		dropReferences(tasks, [fullId]);
		pruneTaskLinks(tasks, liveOrArchived(tasks, archivedIds));
		return null;
	}

	// Its siblings become full IDs, which read the same on a task
	const moved = dependenciesForMovedItem(removed, parentId, undefined);
	const converted = {
		// Stored as a number, as the legacy command wrote it
		id: nextTaskId(
			tasks.map((t) => t.id),
			highestArchivedId
		) as unknown as string,
		title: removed.title,
		description: promotedSubtaskDescription(removed),
		details: removed.details || '',
		status: removed.status || 'pending',
		dependencies: moved.dependencies,
		priority: parent.priority || 'medium'
	} as Task;
	// Keep metadata (and its dependency marks, re-keyed for top level). No
	// dependency on the old parent: a sibling waiting on it would loop (#803)
	assignMetadata(converted, moved.metadata);
	// Whatever depended on the subtask now depends on the task
	retargetDependents(tasks, fullId, converted.id);
	tasks.push(converted);
	return converted;
}

// ========== clear-subtasks ==========

export interface ClearSubtasksResult {
	/** Tasks whose subtasks were removed, in order, with how many */
	cleared: Array<{ id: number | string; title: string; count: number }>;
	/** Tasks that had no subtasks to remove */
	empty: Array<{ id: number | string; title: string }>;
}

/**
 * Remove every subtask of the given tasks ("3,5", or "all"), with every
 * reference to them. Throws, changing nothing, for a subtask ID, an ID that
 * isn't a number or a task that doesn't exist.
 */
export function clearSubtasksIn(
	tasks: Task[],
	ids: string
): ClearSubtasksResult {
	const targets = ids === 'all' ? tasks : resolveTasks(tasks, ids);
	const result: ClearSubtasksResult = { cleared: [], empty: [] };
	for (const task of targets) {
		const count = Array.isArray(task.subtasks) ? task.subtasks.length : 0;
		if (count === 0) result.empty.push({ id: task.id, title: task.title });
		else result.cleared.push({ id: task.id, title: task.title, count });
	}
	// Dependencies and links on the subtasks go with them, in one pass
	removeAllSubtasks(tasks, ...targets);
	return result;
}

/** Check each ID and find its task: in the order given, without repeats */
function resolveTasks(tasks: Task[], ids: string): Task[] {
	const unique = [...new Set(splitIds(ids).map(normalizeTaskId))];
	if (unique.length === 0) {
		throw errorWithHint(ERROR_CODES.INVALID_INPUT, 'No task IDs given');
	}
	const byId = new Map(tasks.map((t) => [String(t.id), t]));
	return unique.map((id) => {
		// parseInt('1.2') is 1, which used to clear every subtask of task 1
		if (/^\d+\.\d+/.test(id)) {
			throw errorWithHint(
				ERROR_CODES.INVALID_INPUT,
				`${id} is a subtask, not a task`,
				`Use \`taskgraph remove-task ${id}\` for one subtask, or \`taskgraph clear-subtasks --id=${id.split('.')[0]}\` for all`
			);
		}
		if (!/^\d+$/.test(id)) {
			throw errorWithHint(
				ERROR_CODES.INVALID_INPUT,
				`"${id}" isn't a task ID`,
				'Use task numbers, such as `--id=3,5`'
			);
		}
		const task = byId.get(id);
		if (!task) {
			throw errorWithHint(ERROR_CODES.TASK_NOT_FOUND, `Task ${id} not found`);
		}
		return task;
	});
}
