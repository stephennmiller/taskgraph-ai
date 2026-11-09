/**
 * @fileoverview What a field-by-field merge of a tag can't see, put right
 * before the driver writes the file (#1093). The storage write funnel does
 * both on every command, but the driver writes tasks.json itself:
 *
 * - A parent whose merged subtasks are a mix of both branches' takes the
 *   status they give it (settleChangedParents, as the write funnel runs it):
 *   one branch added a subtask while the other finished the last one, or
 *   each finished a different one.
 * - A dependency on a task one branch removed while the other added the
 *   dependency is dropped and reported (dropReferences, as remove-task runs
 *   it); the task would never be ready.
 */

import type { Task } from '../../../common/types/index.js';
import { dropReferences } from '../../dependencies/removed-references.js';
import { resolveSubtaskDependency } from '../../dependencies/subtask-dependency.js';
import { isArchivedReference } from '../../tasks/utils/archive.js';
import {
	type ParentDoneGuard,
	settleChangedParents,
	subtaskShapes
} from '../../tasks/utils/parent-status.js';
import {
	fullSubtaskId,
	normalizeTaskId
} from '../../tasks/validation/task-id.js';
import {
	type Item,
	type Json,
	byKey,
	isItemList,
	isObject,
	keyOf,
	own,
	put,
	same
} from './merge-json-utils.js';

/** A dependency the merge dropped: its target is in neither branch's result */
export interface MergeDroppedDependency {
	tag: string;
	/** The task or subtask that had the dependency, such as `5` or `5.2` */
	id: string;
	/** The removed task or subtask it named */
	dependency: string;
}

type Id = string | number;

const isIdList = (value: unknown): value is Id[] | undefined =>
	value === undefined ||
	(Array.isArray(value) &&
		value.every((id) => typeof id === 'number' || typeof id === 'string'));

/**
 * A tag's tasks, typed, when every subtask and dependency list has the
 * stored shape; otherwise none, and a hand-edited file is left as merged.
 */
function tasksOf(tag: unknown): Task[] {
	const tasks = isObject(tag) ? own(tag, 'tasks') : undefined;
	if (!isItemList(tasks)) return [];
	const wellFormed = tasks.every((task) => {
		const subtasks = own(task, 'subtasks');
		return (
			isIdList(own(task, 'dependencies')) &&
			(subtasks === undefined ||
				(isItemList(subtasks) &&
					subtasks.every((sub) => isIdList(own(sub, 'dependencies')))))
		);
	});
	return wellFormed ? (tasks as unknown as Task[]) : [];
}

/** Each dependency in `tasks` on an ID that isn't there: [dependent, target] */
function danglingDependencies(tasks: Task[]): [string, string][] {
	const live = new Set<string>();
	for (const task of tasks) {
		live.add(normalizeTaskId(task.id));
		for (const sub of task.subtasks ?? []) {
			live.add(normalizeTaskId(fullSubtaskId(task.id, sub.id)));
		}
	}
	const dangling: [string, string][] = [];
	const scan = (
		id: string,
		dependencies: Id[] | undefined,
		fullId: (dependency: Id) => string
	) => {
		for (const dependency of dependencies ?? []) {
			const target = normalizeTaskId(fullId(dependency));
			if (!live.has(target)) dangling.push([id, target]);
		}
	};
	for (const task of tasks) {
		scan(String(task.id), task.dependencies, String);
		for (const sub of task.subtasks ?? []) {
			scan(fullSubtaskId(task.id, sub.id), sub.dependencies, (dependency) =>
				resolveSubtaskDependency(task.id, dependency)
			);
		}
	}
	return dangling;
}

/**
 * Settle the merged tag in place: parents, then dependencies.
 *
 * @param ours - The tag on the current branch
 * @param incoming - The tag on the incoming branch, after renumbering
 * @param archivedIds - Task IDs in this branch's archive.json for the tag
 * @param guardDone - The parent's done gate, as the write funnel passes it
 * @returns The dependencies it dropped
 */
export function settleMergedTag(
	merged: Json,
	ours: Json,
	incoming: Json,
	tag: string,
	archivedIds: ReadonlySet<string>,
	guardDone: ParentDoneGuard
): MergeDroppedDependency[] {
	// A copy: tasks only one side has are that side's own objects
	const tasks = structuredClone(tasksOf(merged));
	if (tasks.length === 0) return [];
	put(merged, 'tasks', tasks);
	const sides = [tasksOf(ours), tasksOf(incoming)];

	// A task that is one side's as written keeps the status that branch gave
	// it, such as a parent set done on purpose over open subtasks
	const bySide = sides.map((side) => byKey(side as unknown as Item[]));
	const combined = tasks.filter((task) =>
		bySide.every((side) => {
			const theirs = side.get(keyOf(task as unknown as Item));
			return theirs !== undefined && !same(theirs, task);
		})
	);
	for (const side of sides) {
		settleChangedParents(subtaskShapes(side), combined, guardDone);
	}

	// A target missing on a side that still names it is archived there (this
	// branch's archive.json doesn't have it yet) or was missing before the merge
	const known = new Set(
		sides.flatMap(danglingDependencies).map(([, target]) => target)
	);
	const dropped = danglingDependencies(tasks)
		.filter(
			([, target]) =>
				!known.has(target) && !isArchivedReference(target, archivedIds)
		)
		.map(([id, dependency]) => ({ tag, id, dependency }));
	dropReferences(
		tasks,
		dropped.map((row) => row.dependency)
	);
	return dropped;
}
