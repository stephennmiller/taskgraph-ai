/**
 * @fileoverview Moving tasks, with their subtasks, from one tag to another,
 * for `move --from-tag --to-tag`. See task-moves.ts for the shared rules.
 */

import { ERROR_CODES } from '../../../common/errors/taskgraph-error.js';
import type { Task } from '../../../common/types/index.js';
import {
	assignMetadata,
	pruneDependencySources
} from '../../dependencies/dependency-provenance.js';
import { resolveSubtaskDependency } from '../../dependencies/subtask-dependency.js';
import { pruneTaskLinks } from '../../dependencies/task-links.js';
import { liveOrArchived } from './archive.js';
import { isReservedNewTagName } from './tag-names.js';
import {
	type CrossTagConflict,
	type CrossTagMoveOptions,
	type CrossTagMoveResult,
	type DependencyId,
	type Item,
	MOVE_ERROR_CODES,
	fail,
	findTask,
	notFound,
	taken
} from './task-moves.js';

/** The parent task ID a dependency names: 5 for "5" and for "5.2" */
function dependencyTaskId(dep: unknown): number | null {
	if (typeof dep === 'number') return Number.isFinite(dep) ? dep : null;
	if (typeof dep !== 'string' || dep.trim() === '') return null;
	const parsed = parseInt(dep.trim().split('.')[0], 10);
	return Number.isFinite(parsed) ? parsed : null;
}

/**
 * IDs the tasks depend on, directly or through each other, in the order
 * found (depth first). "5" reads as 5; a subtask ID such as "5.2" stays a
 * string and isn't followed further.
 */
function forwardDependencies(sources: Item[], tasks: Item[]): DependencyId[] {
	const found = new Set<DependencyId>();
	const seen = new Set<DependencyId>();
	const visit = (taskId: DependencyId, depth: number) => {
		if (depth >= 100 || seen.has(taskId)) return;
		seen.add(taskId);
		const task = findTask(tasks, taskId);
		for (const dep of task?.dependencies ?? []) {
			const id =
				typeof dep === 'string' &&
				!dep.includes('.') &&
				!Number.isNaN(parseInt(dep, 10))
					? parseInt(dep, 10)
					: dep;
			if (id == null || id === taskId) continue;
			found.add(id);
			visit(id, depth + 1);
		}
	};
	for (const source of sources) visit(source.id, 0);
	return [...found];
}

/**
 * The tag of the task or subtask a dependency names, looking through the
 * tags in file order (so an ID that also exists in an earlier tag resolves
 * there, as it always has)
 */
function dependencyTag(
	dep: DependencyId,
	tags: Map<string, Task[]>
): string | undefined {
	const depId = String(dep);
	for (const [tag, tasks] of tags) {
		if (findTask(tasks as Item[], depId)) return tag;
	}
	if (!depId.includes('.')) return undefined;
	const [parentId, subtaskId] = depId.split('.');
	for (const [tag, tasks] of tags) {
		const parent = findTask(tasks as Item[], parseInt(parentId, 10));
		if (parent?.subtasks?.some((st: Item) => String(st.id) === subtaskId)) {
			return tag;
		}
	}
	return undefined;
}

/**
 * Move tasks, with their subtasks, from one tag to another, keeping their
 * IDs. A dependency that would point back into the source tag blocks the
 * move unless `withDependencies` brings what they depend on along or
 * `ignoreDependencies` drops it. The target tag is created when missing.
 * @param tags - Every tag's tasks, in file order; changed in place
 * @param archivedIds - Archived task IDs of a tag
 */
export function moveTasksBetweenTags(
	tags: Map<string, Task[]>,
	taskIds: string[],
	sourceTag: string,
	targetTag: string,
	options: CrossTagMoveOptions,
	archivedIds: (tag: string) => ReadonlySet<string>
): CrossTagMoveResult {
	const source = tags.get(sourceTag) as Item[] | undefined;
	if (!source) {
		fail(
			`Source tag "${sourceTag}" not found or invalid`,
			ERROR_CODES.NOT_FOUND
		);
	}
	if (!tags.has(targetTag)) {
		if (isReservedNewTagName(targetTag)) {
			fail(`"${targetTag}" is a reserved tag name`);
		}
		tags.set(targetTag, []);
	}
	const target = tags.get(targetTag) as Item[];

	const sourceTasks = source.filter((t) => taskIds.includes(String(t.id)));
	for (const taskId of taskIds) {
		if (taskId.includes('.')) {
			fail(
				`Cannot move subtask ${taskId} directly between tags.

First promote it to a full task using:
  taskgraph remove-subtask --id=${taskId} --convert`,
				ERROR_CODES.VALIDATION_ERROR,
				{ moveCode: MOVE_ERROR_CODES.CANNOT_MOVE_SUBTASK, taskId }
			);
		}
	}

	let toMove: DependencyId[] = taskIds;
	let ignored = false;
	if (options.withDependencies) {
		const sourceIds = new Set(source.map((t) => String(parseInt(t.id, 10))));
		const dependencies = forwardDependencies(sourceTasks, source)
			.map(dependencyTaskId)
			.filter((id): id is number => id !== null && sourceIds.has(String(id)));
		toMove = [...taskIds];
		for (const id of dependencies) {
			if (!toMove.some((m) => String(m) === String(id))) toMove.push(id);
		}
	} else {
		const movedIds = new Set(sourceTasks.map((t) => String(t.id)));
		const isMoved = (id: DependencyId) =>
			movedIds.has(String(dependencyTaskId(id)));
		const conflicts: CrossTagConflict[] = [];
		// What --ignore-dependencies drops, by the task or subtask holding it
		const drops: { item: Item; parentId?: DependencyId; deps: unknown[] }[] =
			[];
		const holders = source.flatMap((task) => [
			{ item: task, id: String(task.id) },
			...(task.subtasks ?? []).map((st: Item) => ({
				item: st,
				id: `${task.id}.${st.id}`,
				parentId: task.id as DependencyId
			}))
		]);
		for (const { item, id, parentId } of holders) {
			const holderMoved = isMoved(id);
			const deps: unknown[] = [];
			for (const dep of item.dependencies ?? []) {
				if (dep == null) continue;
				const full =
					parentId === undefined
						? String(dep)
						: resolveSubtaskDependency(parentId, dep);
				if (holderMoved && !isMoved(full)) {
					const tag = dependencyTag(full, tags);
					if (tag !== undefined && tag !== targetTag) {
						conflicts.push({
							taskId: id,
							dependencyId: dep,
							dependencyTag: tag,
							message: `Task ${id} depends on ${full} (in ${tag})`
						});
					}
					const depTask = dependencyTaskId(full);
					if (depTask !== null && findTask(source, depTask)) deps.push(dep);
				} else if (!holderMoved && isMoved(full)) {
					// Left behind, it would name an ID the source tag no longer has
					conflicts.push({
						taskId: id,
						dependencyId: dep,
						dependencyTag: targetTag,
						message: `Task ${id} depends on ${full}, which moves to ${targetTag}`
					});
					deps.push(dep);
				}
			}
			if (deps.length > 0) drops.push({ item, parentId, deps });
		}
		if (conflicts.length > 0 && !options.ignoreDependencies) {
			fail(
				`Cannot move tasks: ${conflicts.length} cross-tag dependency conflicts found`,
				ERROR_CODES.TASK_DEPENDENCY_ERROR,
				{
					moveCode: MOVE_ERROR_CODES.CROSS_TAG_DEPENDENCY_CONFLICTS,
					conflicts,
					sourceTag,
					targetTag,
					taskIds
				}
			);
		}
		if (conflicts.length > 0) {
			// Drop what would point across the tags; keep the rest
			for (const { item, parentId, deps } of drops) {
				item.dependencies = item.dependencies.filter(
					(dep: unknown) => !deps.includes(dep)
				);
				if (item.metadata) {
					assignMetadata(item, pruneDependencySources(item, parentId));
				}
			}
			ignored = true;
		}
	}

	const movedTasks: CrossTagMoveResult['movedTasks'] = [];
	const targetArchived = archivedIds(targetTag);
	for (const taskId of toMove) {
		const id = String(parseInt(String(taskId), 10));
		const index = source.findIndex((t) => String(t.id) === id);
		if (index === -1) {
			notFound(`Task ${taskId} not found in source tag "${sourceTag}"`);
		}
		if (targetArchived.has(id)) {
			taken(
				`Task ${id} is archived in tag "${targetTag}", so its ID is taken. Use a different destination ID.`
			);
		}
		if (findTask(target, id)) {
			taken(`Task ${taskId} already exists in target tag "${targetTag}"`, {
				conflictingId: id,
				targetTag
			});
		}
		const [task] = source.splice(index, 1);
		task.tag = targetTag;
		task.metadata ??= {};
		task.metadata.moveHistory ??= [];
		task.metadata.moveHistory.push({
			fromTag: sourceTag,
			toTag: targetTag,
			timestamp: new Date().toISOString()
		});
		target.push(task);
		movedTasks.push({ id: taskId, fromTag: sourceTag, toTag: targetTag });
	}

	// Related and discovered-from links don't cross tags: the same ID names a
	// different task there. Moved tasks keep links among themselves; the
	// source tag drops its links to them.
	const movedIds = new Set(movedTasks.map((moved) => String(moved.id)));
	pruneTaskLinks(
		target.filter((task) => movedIds.has(String(task.id))),
		(id) => movedIds.has(id.split('.')[0])
	);
	pruneTaskLinks(
		source,
		liveOrArchived(source as Task[], () => archivedIds(sourceTag))
	);

	const result: CrossTagMoveResult = {
		message: `Successfully moved ${movedTasks.length} tasks from "${sourceTag}" to "${targetTag}"`,
		movedTasks
	};
	if (ignored) {
		result.tips = [
			'Run "taskgraph validate-dependencies" to check for dependency issues.',
			'Run "taskgraph fix-dependencies" to automatically repair dangling dependencies.'
		];
	}
	return result;
}
