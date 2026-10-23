/**
 * @fileoverview Removing tasks or subtasks without leaving anything pointing
 * at them: dependencies on them, the provenance marks of those dependencies
 * and `related` / `discovered-from` links to them all go too.
 *
 * Used by remove-task, remove-subtask, clear-subtasks and `expand --force`.
 * The last two matter most: new subtasks reuse the old IDs, so a dependency
 * left on `5.2` would silently name a different subtask.
 */

import {
	assignMetadata,
	pruneDependencySources
} from './dependency-provenance.js';
import { resolveSubtaskDependency } from './subtask-dependency.js';
import { pruneTaskLinks } from './task-links.js';

type DependencyId = string | number;
type Metadata = Record<string, unknown>;

interface Referrer {
	id?: DependencyId;
	dependencies?: DependencyId[];
	metadata?: Metadata;
	subtasks?: Referrer[];
}

/**
 * Drop every dependency on, provenance mark for and non-blocking link to the
 * given full IDs ("5", "5.2"), on every task and subtask of `tasks`. Links to
 * an item's own ID and malformed link entries are dropped along the way, as
 * pruneTaskLinks does.
 */
export function dropReferences(
	tasks: Referrer[],
	removedIds: Iterable<string>
): void {
	const removed = new Set(removedIds);
	if (removed.size === 0) return;

	const drop = (
		item: Referrer,
		fullId: (dep: DependencyId) => string,
		parentId?: DependencyId
	) => {
		if (!item.dependencies) return;
		const kept = item.dependencies.filter((dep) => !removed.has(fullId(dep)));
		// Leave untouched items as they are, metadata included
		if (kept.length === item.dependencies.length) return;
		item.dependencies = kept;
		assignMetadata(item, pruneDependencySources(item, parentId));
	};

	for (const task of tasks) {
		drop(task, String);
		for (const subtask of task.subtasks ?? []) {
			drop(
				subtask,
				(dep) => resolveSubtaskDependency(task.id as DependencyId, dep),
				task.id
			);
		}
	}
	pruneTaskLinks(tasks, (id) => !removed.has(id));
}

/**
 * Remove all of `task`'s subtasks, and with them every dependency, mark and
 * link elsewhere in `tasks` that names one. Call it before adding new
 * subtasks, which reuse the IDs.
 *
 * @returns How many subtasks were removed (0 leaves the task as it is)
 */
export function removeAllSubtasks(tasks: Referrer[], task: Referrer): number {
	const subtasks = Array.isArray(task.subtasks) ? task.subtasks : [];
	if (subtasks.length === 0) return 0;
	const ids = subtasks.map((subtask) => `${task.id}.${subtask.id}`);
	task.subtasks = [];
	dropReferences(tasks, ids);
	return ids.length;
}
