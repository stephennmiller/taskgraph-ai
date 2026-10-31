/**
 * @fileoverview Restructuring a tag's tasks, for `add-subtask` and `move`:
 * add a subtask or turn a task into one, move a task or subtask to a new ID
 * within its tag, and move tasks to another tag.
 *
 * Every function changes the arrays it is given in place. A throw can leave
 * them half changed, so the caller saves only on success (storage's
 * mutateTags does): all moves or none.
 * IDs are compared as strings: tm-core stores top-level IDs as strings, older
 * files as numbers.
 */

import {
	ERROR_CODES,
	TaskGraphError
} from '../../../common/errors/taskgraph-error.js';
import { assertTaskStatus } from '../../../common/constants/index.js';
import type { Subtask, Task } from '../../../common/types/index.js';
import { assignMetadata } from '../../dependencies/dependency-provenance.js';
import { wouldSubtaskCloseLoop } from '../../dependencies/dependency-edges.js';
import { resolveSubtaskDependency } from '../../dependencies/subtask-dependency.js';
import {
	dependenciesForConvertedTask,
	retargetDependents
} from '../../dependencies/task-to-subtask.js';

// Tasks as stored: IDs and dependencies may be numbers or strings
export type Item = Record<string, any>;
export type DependencyId = string | number;

/** Codes in `error.details.moveCode`, for a caller that explains the case */
export const MOVE_ERROR_CODES = {
	CROSS_TAG_DEPENDENCY_CONFLICTS: 'CROSS_TAG_DEPENDENCY_CONFLICTS',
	CANNOT_MOVE_SUBTASK: 'CANNOT_MOVE_SUBTASK',
	TASK_ALREADY_EXISTS: 'TASK_ALREADY_EXISTS'
} as const;

/** A dependency of a task moving to another tag that stays behind */
export interface CrossTagConflict {
	taskId: DependencyId;
	dependencyId: DependencyId;
	dependencyTag: string;
	message: string;
	/** The dependency is archived in the source tag, so it can't move along */
	archived?: true;
}

export interface NewSubtaskInput {
	title: string;
	description?: string;
	details?: string;
	status?: string;
	/** Full IDs: "3" is task 3, "5.2" a subtask */
	dependencies?: string[];
}

export interface MoveResult {
	message: string;
	movedItem: Item;
}

export interface WithinTagMoveResult {
	/** One per pair moved, in order */
	moves: MoveResult[];
	/** Pairs of a batch whose source and destination are the same ID */
	skipped: Array<{ fromId: string; toId: string }>;
}

export interface CrossTagMoveOptions {
	/** Also move what the tasks depend on in the source tag */
	withDependencies?: boolean;
	/** Drop the dependencies that would point into the source tag */
	ignoreDependencies?: boolean;
}

export interface CrossTagMoveResult {
	message: string;
	/** IDs as asked for; ones moved along as dependencies are numbers */
	movedTasks: Array<{ id: DependencyId; fromTag: string; toTag: string }>;
	/** After ignoreDependencies dropped some: how to check what's left */
	tips?: string[];
}

export function fail(
	message: string,
	code: string = ERROR_CODES.VALIDATION_ERROR,
	details?: Record<string, unknown>
): never {
	throw new TaskGraphError(message, code, details && { details });
}

export function notFound(message: string): never {
	fail(message, ERROR_CODES.TASK_NOT_FOUND);
}

export function taken(
	message: string,
	details?: Record<string, unknown>
): never {
	fail(message, ERROR_CODES.VALIDATION_ERROR, {
		moveCode: MOVE_ERROR_CODES.TASK_ALREADY_EXISTS,
		...details
	});
}

export const findTask = (tasks: Item[], id: DependencyId) =>
	tasks.find((t) => String(t.id) === String(id));

const nextSubtaskId = (parent: Item) =>
	String(
		parent.subtasks.length > 0
			? Math.max(...parent.subtasks.map((st: Item) => Number(st.id))) + 1
			: 1
	);

/**
 * Add a subtask to `parentId`: a new one, or the task `fromTaskId` turned
 * into one (what depended on that task then depends on the subtask).
 * @returns The subtask as stored
 */
export function addSubtaskIn(
	tasks: Task[],
	parentId: string,
	source: { fromTaskId: string } | { subtask: NewSubtaskInput }
): Subtask {
	const items = tasks as Item[];
	const parentIdNum = parseInt(parentId, 10);
	const parentTask = findTask(items, parentIdNum);
	if (!parentTask) notFound(`Parent task with ID ${parentIdNum} not found`);
	parentTask.subtasks ??= [];
	const newSubtaskId = nextSubtaskId(parentTask);

	if ('subtask' in source) {
		const data = source.subtask;
		const status = data.status || 'pending';
		assertTaskStatus(status, { parentId, newStatus: status });
		const dependencies = (data.dependencies || []).map((dep) =>
			resolveSubtaskDependency(parentIdNum, dep)
		);
		if (wouldSubtaskCloseLoop(tasks, String(parentIdNum), { dependencies })) {
			fail(
				`Cannot add a subtask to task ${parentIdNum} that depends on ${dependencies.join(', ')}: that would make a dependency loop`,
				ERROR_CODES.TASK_DEPENDENCY_ERROR
			);
		}
		const subtask: Item = {
			id: newSubtaskId,
			title: data.title,
			description: data.description || '',
			details: data.details || '',
			status,
			dependencies: data.dependencies || []
		};
		parentTask.subtasks.push(subtask);
		return subtask as unknown as Subtask;
	}

	const taskIdNum = parseInt(source.fromTaskId, 10);
	const taskIndex = items.findIndex((t) => String(t.id) === String(taskIdNum));
	if (taskIndex === -1) notFound(`Task with ID ${taskIdNum} not found`);
	const task = items[taskIndex];
	if (taskIdNum === parentIdNum) {
		fail('Cannot make a task a subtask of itself');
	}
	if (
		wouldSubtaskCloseLoop(tasks, String(parentIdNum), {
			fromTaskId: String(taskIdNum)
		})
	) {
		fail(
			`Cannot make task ${taskIdNum} a subtask of task ${parentIdNum}: that would make a dependency loop`,
			ERROR_CODES.TASK_DEPENDENCY_ERROR
		);
	}

	// Its dependencies were task IDs; under a subtask a bare number is a sibling
	const { dependencies, metadata } = dependenciesForConvertedTask(
		task,
		parentIdNum
	);
	const subtask: Item = {
		...task,
		id: newSubtaskId,
		dependencies
	};
	assignMetadata(subtask, metadata);
	parentTask.subtasks.push(subtask);
	items.splice(taskIndex, 1);
	retargetDependents(
		items,
		String(taskIdNum),
		`${parentIdNum}.${newSubtaskId}`
	);
	return subtask as unknown as Subtask;
}
