/**
 * @fileoverview Moving tasks and subtasks to new IDs within one tag, for
 * `move --from --to`. See task-moves.ts for the shared rules.
 */

import { ERROR_CODES } from '../../../common/errors/taskgraph-error.js';
import type { Task } from '../../../common/types/index.js';
import {
	assignMetadata,
	rekeyDependencySources
} from '../../dependencies/dependency-provenance.js';
import { retargetTaskLinks } from '../../dependencies/task-links.js';
import {
	dependenciesForConvertedTask,
	dependenciesForMovedItem,
	retargetDependents
} from '../../dependencies/task-to-subtask.js';
import { isValidTaskIdFormat } from '../validation/task-id.js';
import { promotedSubtaskDescription } from './promoted-subtask.js';
import {
	type DependencyId,
	type Item,
	type MoveResult,
	type WithinTagMoveResult,
	fail,
	findTask,
	notFound,
	taken
} from './task-moves.js';

/**
 * Move tasks or subtasks to new IDs within one tag: `from` and `to` are one
 * ID each ("5", "5.2") or as many comma-separated. A task can't land on a
 * taken or archived ID; what depended on a moved item follows it.
 * @param archivedIds - The tag's archived task IDs, which stay reserved
 */
export function moveTasksIn(
	tasks: Task[],
	from: string,
	to: string,
	tag: string,
	archivedIds: ReadonlySet<string>
): WithinTagMoveResult {
	const sourceIds = from.split(',').map((id) => id.trim());
	const destinationIds = to.split(',').map((id) => id.trim());
	if (sourceIds.length !== destinationIds.length) {
		fail(
			`Number of source IDs (${sourceIds.length}) must match number of destination IDs (${destinationIds.length})`,
			ERROR_CODES.INVALID_INPUT
		);
	}
	// parseInt would turn "abc" into a task stored with ID "NaN"
	const invalid = [...sourceIds, ...destinationIds].find(
		(id) => !isValidTaskIdFormat(id)
	);
	if (invalid !== undefined) {
		fail(
			`Invalid task ID "${invalid}": use a task ID such as 5 or a subtask ID such as 5.2`,
			ERROR_CODES.INVALID_INPUT
		);
	}

	const result: WithinTagMoveResult = { moves: [], skipped: [] };
	sourceIds.forEach((sourceId, i) => {
		const destinationId = destinationIds[i];
		if (sourceIds.length > 1 && sourceId === destinationId) {
			result.skipped.push({ fromId: sourceId, toId: destinationId });
			return;
		}
		result.moves.push(
			moveOne(tasks as Item[], sourceId, destinationId, tag, archivedIds)
		);
	});
	return result;
}

function moveOne(
	tasks: Item[],
	sourceId: string,
	destinationId: string,
	tag: string,
	archivedIds: ReadonlySet<string>
): MoveResult {
	const isSourceSubtask = sourceId.includes('.');
	const isDestSubtask = destinationId.includes('.');
	if (!isDestSubtask) {
		const destId = parseInt(destinationId, 10);
		if (archivedIds.has(String(destId))) {
			taken(
				`Task ${destId} is archived in tag "${tag}", so its ID is taken. Use a different destination ID.`
			);
		}
	}
	if (isSourceSubtask && isDestSubtask)
		return moveSubtaskToSubtask(tasks, sourceId, destinationId);
	if (isSourceSubtask) return moveSubtaskToTask(tasks, sourceId, destinationId);
	if (isDestSubtask) return moveTaskToSubtask(tasks, sourceId, destinationId);
	return moveTaskToTask(tasks, sourceId, destinationId);
}

const parseSubtaskId = (id: string) =>
	id.split('.').map((part) => parseInt(part, 10));

/** Insert after the subtask `subtaskId`, or at the end when there is none */
function insertSubtask(parent: Item, subtaskId: number, subtask: Item) {
	const at = parent.subtasks.findIndex(
		(st: Item) => Number(st.id) === subtaskId
	);
	parent.subtasks.splice(
		at === -1 ? parent.subtasks.length : at + 1,
		0,
		subtask
	);
}

function moveSubtaskToSubtask(
	tasks: Item[],
	sourceId: string,
	destinationId: string
): MoveResult {
	const [sourceParentId, sourceSubtaskId] = parseSubtaskId(sourceId);
	const [destParentId, destSubtaskId] = parseSubtaskId(destinationId);
	const sourceParent = findTask(tasks, sourceParentId);
	const destParent = findTask(tasks, destParentId);
	if (!sourceParent)
		notFound(`Source parent task with ID ${sourceParentId} not found`);
	if (!destParent)
		notFound(`Destination parent task with ID ${destParentId} not found`);
	sourceParent.subtasks ??= [];
	destParent.subtasks ??= [];

	const sourceIndex = sourceParent.subtasks.findIndex(
		(st: Item) => Number(st.id) === sourceSubtaskId
	);
	if (sourceIndex === -1) notFound(`Source subtask ${sourceId} not found`);
	const subtask = sourceParent.subtasks[sourceIndex];

	if (sourceParentId === destParentId) {
		// Reorder within the parent: it goes after the destination subtask
		const destIndex = destParent.subtasks.findIndex(
			(st: Item) => Number(st.id) === destSubtaskId
		);
		sourceParent.subtasks.splice(sourceIndex, 1);
		if (destIndex === -1) {
			destParent.subtasks.push(subtask);
		} else {
			const adjusted = sourceIndex < destIndex ? destIndex - 1 : destIndex;
			destParent.subtasks.splice(adjusted + 1, 0, subtask);
		}
	} else {
		if (
			destParent.subtasks.some((st: Item) => Number(st.id) === destSubtaskId)
		) {
			taken(
				`Subtask ${destParentId}.${destSubtaskId} already exists. Use a different destination ID`
			);
		}
		// Its siblings stay the subtasks they were, so they're written as full IDs
		const moved = dependenciesForMovedItem(
			subtask,
			sourceParent.id,
			destParent.id
		);
		const newSubtask: Item = {
			...subtask,
			id: destSubtaskId,
			dependencies: moved.dependencies
		};
		assignMetadata(newSubtask, moved.metadata);
		insertSubtask(destParent, destSubtaskId, newSubtask);
		sourceParent.subtasks.splice(sourceIndex, 1);
		retargetDependents(
			tasks,
			`${sourceParent.id}.${subtask.id}`,
			`${destParent.id}.${destSubtaskId}`
		);
	}

	return {
		message: `Moved subtask ${sourceId} to ${destinationId}`,
		movedItem: subtask
	};
}

function moveSubtaskToTask(
	tasks: Item[],
	sourceId: string,
	destinationId: string
): MoveResult {
	const [sourceParentId, sourceSubtaskId] = parseSubtaskId(sourceId);
	const destTaskId = parseInt(destinationId, 10);
	const sourceParent = findTask(tasks, sourceParentId);
	if (!sourceParent)
		notFound(`Source parent task with ID ${sourceParentId} not found`);
	if (!sourceParent.subtasks)
		notFound(`Source parent task ${sourceParentId} has no subtasks`);
	const sourceIndex = sourceParent.subtasks.findIndex(
		(st: Item) => Number(st.id) === sourceSubtaskId
	);
	if (sourceIndex === -1) notFound(`Source subtask ${sourceId} not found`);
	const subtask = sourceParent.subtasks[sourceIndex];
	if (findTask(tasks, destTaskId)) {
		taken(
			`Cannot move to existing task ID ${destTaskId}. Choose a different ID or use subtask destination.`
		);
	}

	// The subtask's siblings become full IDs, which read the same on a task
	const moved = dependenciesForMovedItem(subtask, sourceParent.id, undefined);
	const newTask: Item = {
		id: destTaskId,
		title: subtask.title,
		description: promotedSubtaskDescription(subtask),
		status: subtask.status || 'pending',
		dependencies: moved.dependencies,
		priority: subtask.priority || 'medium',
		details: subtask.details || '',
		testStrategy: subtask.testStrategy || '',
		subtasks: []
	};
	assignMetadata(newTask, moved.metadata);
	sourceParent.subtasks.splice(sourceIndex, 1);
	retargetDependents(
		tasks,
		`${sourceParent.id}.${sourceSubtaskId}`,
		destTaskId
	);

	const insertIndex = tasks.findIndex((t) => Number(t.id) > destTaskId);
	if (insertIndex === -1) tasks.push(newTask);
	else tasks.splice(insertIndex, 0, newTask);

	return {
		message: `Converted subtask ${sourceId} to task ${destinationId}`,
		movedItem: newTask
	};
}

function moveTaskToSubtask(
	tasks: Item[],
	sourceId: string,
	destinationId: string
): MoveResult {
	const sourceTaskId = parseInt(sourceId, 10);
	const [destParentId, destSubtaskId] = parseSubtaskId(destinationId);
	const sourceIndex = tasks.findIndex(
		(t) => String(t.id) === String(sourceTaskId)
	);
	const destParent = findTask(tasks, destParentId);
	if (sourceIndex === -1)
		notFound(`Source task with ID ${sourceTaskId} not found`);
	if (!destParent)
		notFound(`Destination parent task with ID ${destParentId} not found`);
	const sourceTask = tasks[sourceIndex];

	// Moving a task under itself would delete it along with its subtasks
	if (destParentId === sourceTaskId) {
		fail(`Cannot move task ${sourceTaskId} inside itself`);
	}
	// Subtasks can't have subtasks, so they would be dropped
	if (sourceTask.subtasks?.length > 0) {
		fail(
			`Task ${sourceTaskId} has subtasks and cannot become a subtask. Move or remove its subtasks first`
		);
	}
	if (
		destParent.subtasks?.some((st: Item) => Number(st.id) === destSubtaskId)
	) {
		taken(
			`Subtask ${destParentId}.${destSubtaskId} already exists. Use a different destination ID`
		);
	}
	destParent.subtasks ??= [];

	// Under a subtask a bare number would name a sibling, so its task
	// dependencies are written as strings (and the new parent dropped)
	const converted = dependenciesForConvertedTask(sourceTask, destParent.id);
	const newSubtask: Item = {
		id: destSubtaskId,
		title: sourceTask.title,
		description: sourceTask.description,
		status: sourceTask.status || 'pending',
		dependencies: converted.dependencies,
		details: sourceTask.details || '',
		testStrategy: sourceTask.testStrategy || ''
	};
	assignMetadata(newSubtask, converted.metadata);
	insertSubtask(destParent, destSubtaskId, newSubtask);
	tasks.splice(sourceIndex, 1);
	retargetDependents(
		tasks,
		String(sourceTaskId),
		`${destParent.id}.${destSubtaskId}`
	);

	return {
		message: `Converted task ${sourceId} to subtask ${destinationId}`,
		movedItem: newSubtask
	};
}

function moveTaskToTask(
	tasks: Item[],
	sourceId: string,
	destinationId: string
): MoveResult {
	const sourceTaskId = parseInt(sourceId, 10);
	const destTaskId = parseInt(destinationId, 10);
	const sourceIndex = tasks.findIndex(
		(t) => String(t.id) === String(sourceTaskId)
	);
	if (sourceIndex === -1)
		notFound(`Source task with ID ${sourceTaskId} not found`);
	if (findTask(tasks, destTaskId)) {
		taken(
			`Task with ID ${destTaskId} already exists. Use a different destination ID.`
		);
	}
	const sourceTask = tasks[sourceIndex];
	const movedTask: Item = { ...sourceTask, id: destTaskId };
	const oldId = String(sourceTask.id);
	tasks.splice(sourceIndex, 1);
	tasks.push(movedTask);

	// Dependencies on the old ID follow it (as a string on a subtask, where a
	// bare number is a sibling)
	retargetDependents(tasks, oldId, destTaskId);

	// Its subtasks' full-ID references to each other ("4.1") follow the new ID
	for (const subtask of movedTask.subtasks ?? []) {
		if (!Array.isArray(subtask.dependencies)) continue;
		const rewrite = (dep: DependencyId) => {
			if (typeof dep === 'string' && dep.includes('.')) {
				const [depParent, depSub] = dep.split('.');
				if (String(parseInt(depParent, 10)) === oldId) {
					return `${destTaskId}.${depSub}`;
				}
			}
			return dep;
		};
		if (subtask.metadata) {
			assignMetadata(
				subtask,
				rekeyDependencySources(subtask, sourceTask.id, destTaskId, rewrite)
			);
		}
		subtask.dependencies = subtask.dependencies.map(rewrite);
	}

	// Related and discovered-from links to the task or its subtasks follow it
	retargetTaskLinks(tasks, sourceTask.id, destTaskId, { withSubtasks: true });

	return {
		message: `Moved task ${sourceTask.id} to new ID ${destTaskId}`,
		movedItem: movedTask
	};
}
