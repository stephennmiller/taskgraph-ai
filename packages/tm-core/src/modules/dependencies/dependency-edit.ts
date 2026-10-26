/**
 * @fileoverview `add-dependency` and `remove-dependency` on a tag's tasks as
 * stored. A blocking dependency goes in the task's `dependencies`; a
 * `related` or `discovered-from` link goes in its metadata and never holds
 * the task back (see task-links.ts).
 *
 * IDs are compared as strings, since older files store task IDs as numbers.
 * A top-level task's list is saved as strings (`toTaskDependency`); a
 * subtask's keeps its types, because there a bare number is a sibling.
 */

import {
	ERROR_CODES,
	errorWithHint
} from '../../common/errors/taskgraph-error.js';
import type { Subtask, Task } from '../../common/types/index.js';
import { isArchivedReference } from '../tasks/utils/archive.js';
import { createTaskLookup } from './dependency-check.js';
import { wouldCloseDependencyLoop } from './dependency-edges.js';
import {
	assignMetadata,
	hasDependency,
	setDependencySource
} from './dependency-provenance.js';
import {
	resolveSubtaskDependency,
	toTaskDependency
} from './subtask-dependency.js';
import {
	getLinkType,
	type LinkType,
	type NonBlockingLinkType,
	parseLinkType,
	removeTaskLink,
	setTaskLink
} from './task-links.js';

const LIST_HINT = 'Run `taskgraph list` to see task IDs';

export interface AddDependencyResult {
	taskId: string;
	dependencyId: string;
	type: LinkType;
	/** Whether tasks.json changed */
	changed: boolean;
	/** What happened, in one sentence */
	message: string;
}

export interface RemoveDependencyResult {
	taskId: string;
	dependencyId: string;
	/** Whether tasks.json changed: a dependency the task never had isn't */
	removed: boolean;
	message: string;
}

/** `3` and `03` are task 3; `3.2` is kept as typed */
function formatId(id: string): string {
	const trimmed = String(id).trim();
	if (trimmed.includes('.')) return trimmed;
	const number = parseInt(trimmed, 10);
	return Number.isNaN(number) ? trimmed : String(number);
}

/** The task or subtask an ID names, with the parent ID for a subtask */
function findTarget(
	tasks: Task[],
	taskId: string
): { item: Task | Subtask; parentId?: string } {
	if (!taskId.includes('.')) {
		const task = tasks.find((t) => String(t.id) === taskId);
		if (!task) {
			throw errorWithHint(
				ERROR_CODES.TASK_NOT_FOUND,
				`Task ${taskId} not found`,
				LIST_HINT
			);
		}
		return { item: task };
	}

	const [parentId, subtaskId] = taskId.split('.').map((n) => parseInt(n, 10));
	const parent = tasks.find((t) => String(t.id) === String(parentId));
	if (!parent) {
		throw errorWithHint(
			ERROR_CODES.TASK_NOT_FOUND,
			`Task ${parentId} not found`,
			LIST_HINT
		);
	}
	if (!parent.subtasks) {
		throw errorWithHint(
			ERROR_CODES.VALIDATION_ERROR,
			`Task ${parentId} has no subtasks`,
			`Add some with \`taskgraph expand --id=${parentId}\``
		);
	}
	const subtask = parent.subtasks.find(
		(s) => String(s.id) === String(subtaskId)
	);
	if (!subtask) {
		throw errorWithHint(
			ERROR_CODES.TASK_NOT_FOUND,
			`Subtask ${taskId} not found`,
			LIST_HINT
		);
	}
	return { item: subtask, parentId: String(parent.id) };
}

/** `related to task 3`, `marked as discovered from task 3` */
function describeLink(type: NonBlockingLinkType, dependencyId: string): string {
	return type === 'related'
		? `related to task ${dependencyId}`
		: `marked as discovered from task ${dependencyId}`;
}

function markExplicit(
	item: Task | Subtask,
	dependencyId: string | number,
	parentId?: string
): void {
	assignMetadata(
		item,
		setDependencySource(item.metadata, dependencyId, 'explicit', parentId)
	);
}

/** Numbers first, then IDs by task and subtask number ("3" before "3.1") */
function compareDependencies(a: string | number, b: string | number): number {
	if (typeof a === 'number' && typeof b === 'number') return a - b;
	if (typeof a === 'string' && typeof b === 'string') {
		const [aParent, aChild] = a.split('.').map(Number);
		const [bParent, bChild] = b.split('.').map(Number);
		return aParent !== bParent
			? aParent - bParent
			: (aChild ?? 0) - (bChild ?? 0);
	}
	return typeof a === 'number' ? -1 : 1;
}

/**
 * Make `taskId` depend on `dependsOn`, or link them without blocking. Changes
 * `tasks` in place; throws, changing nothing, for an unknown or archived ID,
 * a dependency on itself, or one that would make a loop.
 * @param archivedIds - The tag's archived task IDs
 * @param linkType - `blocks` (the default), `related` or `discovered-from`
 */
export function addDependencyIn(
	tasks: Task[],
	taskIdInput: string,
	dependsOnInput: string,
	archivedIds: ReadonlySet<string>,
	linkType?: string
): AddDependencyResult {
	const type = parseLinkType(linkType);
	if (!type) {
		throw errorWithHint(
			ERROR_CODES.VALIDATION_ERROR,
			`"${linkType}" isn't a link type`,
			'Use --type=blocks, related or discovered-from'
		);
	}
	const taskId = formatId(taskIdInput);
	const dependencyId = formatId(dependsOnInput);
	const result = (changed: boolean, message: string): AddDependencyResult => ({
		taskId,
		dependencyId,
		type,
		changed,
		message
	});

	if (!createTaskLookup(tasks)(dependencyId)) {
		if (isArchivedReference(dependencyId, archivedIds)) {
			const archivedId = dependencyId.split('.')[0];
			throw errorWithHint(
				ERROR_CODES.TASK_NOT_FOUND,
				`Task ${archivedId} is archived, so it already counts as done`,
				`Run \`taskgraph archive restore ${archivedId}\` to depend on it again`
			);
		}
		throw errorWithHint(
			ERROR_CODES.TASK_NOT_FOUND,
			`Task ${dependencyId} not found`,
			LIST_HINT
		);
	}

	const { item, parentId } = findTarget(tasks, taskId);
	if (!item.dependencies) item.dependencies = [];

	// A related or discovered-from link is kept apart from the dependencies,
	// so it can't hold the task back and can't make a loop
	if (type !== 'blocks') {
		if (taskId === dependencyId) {
			throw errorWithHint(
				ERROR_CODES.VALIDATION_ERROR,
				`Task ${taskId} can't link to itself`
			);
		}
		const current = getLinkType(item, dependencyId, parentId);
		if (current === type) {
			return result(
				false,
				`Task ${taskId} is already ${describeLink(type, dependencyId)}; nothing changed`
			);
		}
		if (current === 'blocks') {
			const fullId = (dep: string | number) =>
				parentId === undefined
					? String(dep)
					: resolveSubtaskDependency(parentId, dep);
			item.dependencies = (item.dependencies as Array<string | number>).filter(
				(dep) => fullId(dep) !== dependencyId
			) as string[];
			markExplicit(item, dependencyId, parentId);
		}
		assignMetadata(item, setTaskLink(item.metadata, dependencyId, type));
		return result(
			true,
			`Task ${taskId} is now ${describeLink(type, dependencyId)}` +
				(current === 'blocks' ? ' and no longer waits for it' : '')
		);
	}

	// A subtask sibling may be stored as 1 or "2.1"
	if (hasDependency(item, dependencyId, parentId)) {
		// Adding it by hand makes an AI-inferred dependency explicit
		const before = JSON.stringify(item.metadata);
		markExplicit(item, dependencyId, parentId);
		return JSON.stringify(item.metadata) !== before
			? result(
					true,
					`Task ${taskId} now lists task ${dependencyId} as an explicit dependency`
				)
			: result(
					false,
					`Task ${taskId} already depends on task ${dependencyId}; nothing changed`
				);
	}

	if (taskId === dependencyId) {
		throw errorWithHint(
			ERROR_CODES.VALIDATION_ERROR,
			`Task ${taskId} can't depend on itself`
		);
	}
	const loopsBackTo = wouldCloseDependencyLoop(tasks, taskId, dependencyId);
	if (loopsBackTo) {
		throw errorWithHint(
			ERROR_CODES.TASK_DEPENDENCY_ERROR,
			`That would make a loop: task ${dependencyId} already depends on task ${loopsBackTo}`,
			'Run `taskgraph graph` to see how they connect'
		);
	}

	const dependencies: Array<string | number> = [
		...item.dependencies,
		dependencyId
	];
	// A task's list is all strings, as tm-core saves it; a subtask's keeps its
	// types, which say whether a bare number is a sibling or a task
	item.dependencies = (
		parentId === undefined ? dependencies.map(toTaskDependency) : dependencies
	).sort(compareDependencies) as string[];
	assignMetadata(item, removeTaskLink(item.metadata, dependencyId));
	// A person added it, so it is explicit (clears any stale inferred mark)
	markExplicit(item, dependencyId, parentId);
	return result(true, `Task ${taskId} now depends on task ${dependencyId}`);
}

/**
 * Remove a dependency, or a related / discovered-from link, from a task.
 * Changes `tasks` in place. A dependency the task never had changes nothing
 * and isn't an error; an unknown task is.
 */
export function removeDependencyIn(
	tasks: Task[],
	taskIdInput: string,
	dependsOnInput: string
): RemoveDependencyResult {
	const taskId = formatId(taskIdInput);
	const dependencyId = formatId(dependsOnInput);
	const result = (removed: boolean, message: string) => ({
		taskId,
		dependencyId,
		removed,
		message
	});

	const { item, parentId } = findTarget(tasks, taskId);

	const linkType = getLinkType(item, dependencyId, parentId);
	if (linkType && linkType !== 'blocks') {
		assignMetadata(item, removeTaskLink(item.metadata, dependencyId));
		return result(
			true,
			`Task ${taskId} is no longer linked to task ${dependencyId}`
		);
	}

	const dependencies = (item.dependencies ?? []) as Array<string | number>;
	if (dependencies.length === 0) {
		return result(false, `Task ${taskId} has no dependencies; nothing changed`);
	}

	// On a subtask a bare number is a sibling (stored 1 for "1.1"), a string
	// without a dot is a task
	const index = dependencies.findIndex(
		(dep) =>
			(parentId === undefined
				? String(dep)
				: resolveSubtaskDependency(parentId, dep)) === dependencyId
	);
	if (index === -1) {
		return result(
			false,
			`Task ${taskId} doesn't depend on task ${dependencyId}; nothing changed`
		);
	}

	// Remove the dependency, and its provenance mark with it
	const [removed] = dependencies.splice(index, 1);
	markExplicit(item, removed, parentId);
	return result(
		true,
		`Task ${taskId} no longer depends on task ${dependencyId}`
	);
}
