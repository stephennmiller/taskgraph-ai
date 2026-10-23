/**
 * @fileoverview Dependencies of a task or subtask that changes place: a task
 * becomes a subtask (`add-subtask --task-id`, `move --to=5.3`), a subtask
 * becomes a task (`remove-subtask --convert`, `move --to=9`) or moves to
 * another parent.
 *
 * A stored dependency means different things in different places: under a
 * subtask a bare number is a sibling (see `resolveSubtaskDependency`), at the
 * top level it is a task. So the moved item's dependencies are written as full
 * IDs (`"2"`, `"5.1"`), which read the same anywhere. A dependency on the new
 * parent is dropped: it would be a dependency on its own parent. Provenance
 * follows: marks are keyed by full ID, so they carry over for the
 * dependencies that stay.
 *
 * Whatever else pointed at the item (`retargetDependents`) is repointed at its
 * new ID so it doesn't dangle, non-blocking links included.
 */

import {
	assignMetadata,
	pruneDependencySources,
	rekeyDependencySources,
	renameDependencySource
} from './dependency-provenance.js';
import { resolveSubtaskDependency } from './subtask-dependency.js';
import { retargetTaskLinks } from './task-links.js';

type Metadata = Record<string, unknown>;
type DependencyId = string | number;

export interface ConvertedTaskDependencies {
	dependencies: string[];
	metadata: Metadata | undefined;
}

/**
 * The dependencies and metadata an item keeps when it moves from under
 * `fromParentId` (undefined for a top-level task) to under `toParentId`
 * (undefined for a top-level task).
 */
export function dependenciesForMovedItem(
	item: { dependencies?: DependencyId[]; metadata?: Metadata },
	fromParentId: DependencyId | undefined,
	toParentId: DependencyId | undefined
): ConvertedTaskDependencies {
	const fullId = (dep: DependencyId) =>
		fromParentId === undefined
			? String(dep)
			: resolveSubtaskDependency(fromParentId, dep);
	const newParent = toParentId === undefined ? undefined : String(toParentId);

	const dependencies = [
		...new Set((item.dependencies ?? []).map(fullId))
	].filter((dep) => dep !== newParent);

	const rekeyed = rekeyDependencySources(item, fromParentId, newParent, fullId);
	const metadata = pruneDependencySources(
		{ dependencies, metadata: rekeyed },
		newParent
	);
	return { dependencies, metadata };
}

/**
 * The dependencies and metadata a top-level task keeps as a subtask of
 * `parentId`.
 */
export function dependenciesForConvertedTask(
	task: { dependencies?: DependencyId[]; metadata?: Metadata },
	parentId: DependencyId
): ConvertedTaskDependencies {
	return dependenciesForMovedItem(task, undefined, parentId);
}

interface Dependent {
	id?: DependencyId;
	dependencies?: DependencyId[];
	metadata?: Metadata;
	subtasks?: Dependent[];
}

/**
 * Point every dependency on `oldId` (a full ID: "8" or "5.3") at `newId`, on
 * every task and subtask, with its provenance mark, and every non-blocking
 * link to it. A top-level task keeps
 * `newId` as given; a subtask gets it as a string, since under a subtask a
 * bare number would name a sibling.
 */
export function retargetDependents(
	tasks: Dependent[],
	oldId: string,
	newId: DependencyId
): void {
	const rewrite = (
		item: Dependent,
		fullId: (dep: DependencyId) => string,
		replacement: DependencyId,
		parentId?: DependencyId
	) => {
		if (!item.dependencies?.some((dep) => fullId(dep) === oldId)) return;
		item.dependencies = item.dependencies.map((dep) =>
			fullId(dep) === oldId ? replacement : dep
		);
		assignMetadata(
			item,
			renameDependencySource(
				item.metadata,
				oldId,
				String(replacement),
				parentId
			)
		);
	};

	for (const task of tasks) {
		rewrite(task, String, newId);
		for (const subtask of task.subtasks ?? []) {
			rewrite(
				subtask,
				(dep) => resolveSubtaskDependency(task.id as DependencyId, dep),
				String(newId),
				task.id
			);
		}
	}
	retargetTaskLinks(tasks, oldId, newId);
}
