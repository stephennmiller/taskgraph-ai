/**
 * @fileoverview add-subtask and move against storage: each is one locked
 * write of tasks.json through IStorage.mutateTags, so a move that fails
 * part way saves nothing, and a tag the file doesn't have is never created
 * by a write to it.
 */

import {
	ERROR_CODES,
	TaskGraphError
} from '../../../common/errors/taskgraph-error.js';
import type { IStorage } from '../../../common/interfaces/storage.interface.js';
import type { Subtask, Task } from '../../../common/types/index.js';
import { parseSubtaskDependencyInput } from '../../dependencies/subtask-dependency.js';
import { moveTasksBetweenTags } from '../utils/move-between-tags.js';
import { moveTasksIn } from '../utils/move-within-tag.js';
import {
	type CrossTagMoveOptions,
	type CrossTagMoveResult,
	type WithinTagMoveResult,
	addSubtaskIn
} from '../utils/task-moves.js';

/** What `addSubtask` makes: a subtask from `fromTaskId`, else a new one */
export interface AddSubtaskInput {
	fromTaskId?: string;
	title?: string;
	description?: string;
	details?: string;
	status?: string;
	/** Comma-separated: 3 is task 3, 5.2 that subtask */
	dependencies?: string;
}

/** Change one tag's tasks in a locked write; the tag must exist */
function mutateTag<R>(
	storage: IStorage,
	tag: string,
	change: (tasks: Task[]) => R
): Promise<R> {
	return storage.mutateTags((tags) => {
		const tasks = tags.get(tag);
		if (!tasks) {
			throw new TaskGraphError(
				`Tag "${tag}" not found`,
				ERROR_CODES.NOT_FOUND,
				{
					details: { tagName: tag }
				}
			);
		}
		return { result: change(tasks), changed: [tag] };
	});
}

export function addSubtaskToTag(
	storage: IStorage,
	tag: string,
	parentId: string,
	input: AddSubtaskInput
): Promise<Subtask> {
	const { fromTaskId, title, dependencies, ...fields } = input;
	if (!fromTaskId && !title) {
		throw new TaskGraphError(
			'Either taskId or title must be provided',
			ERROR_CODES.INVALID_INPUT
		);
	}
	const source = fromTaskId
		? { fromTaskId }
		: {
				subtask: {
					...fields,
					title: title as string,
					dependencies: dependencies
						? parseSubtaskDependencyInput(dependencies)
						: []
				}
			};
	return mutateTag(storage, tag, (tasks) =>
		addSubtaskIn(tasks, String(parentId), source)
	);
}

export async function moveTasksWithinTag(
	storage: IStorage,
	tag: string,
	from: string,
	to: string
): Promise<WithinTagMoveResult> {
	const archived = await storage.loadArchivedTaskIds(tag);
	return mutateTag(storage, tag, (tasks) =>
		moveTasksIn(tasks, from, to, tag, archived)
	);
}

export async function moveTasksToTag(
	storage: IStorage,
	taskIds: string[],
	fromTag: string,
	toTag: string,
	options: CrossTagMoveOptions
): Promise<CrossTagMoveResult> {
	const [fromArchived, toArchived] = await Promise.all([
		storage.loadArchivedTaskIds(fromTag),
		storage.loadArchivedTaskIds(toTag)
	]);
	const archived = new Map([
		[fromTag, fromArchived],
		[toTag, toArchived]
	]);
	return storage.mutateTags((tags) => ({
		result: moveTasksBetweenTags(
			tags,
			taskIds,
			fromTag,
			toTag,
			options,
			(tag) => archived.get(tag) ?? new Set()
		),
		changed: [fromTag, toTag]
	}));
}
