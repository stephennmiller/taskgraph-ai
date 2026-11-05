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
import { retargetDependents } from '../../dependencies/task-to-subtask.js';
import { canonicalTaskId, normalizeTaskId } from '../validation/task-id.js';
import { isArchivedReference, liveOrArchived, nextTaskId } from './archive.js';
import { assertTagName, isReservedNewTagName } from './tag-names.js';
import {
	type CrossTagConflict,
	type CrossTagMoveOptions,
	type CrossTagMoveResult,
	type DependencyId,
	type Item,
	MOVE_ERROR_CODES,
	fail,
	findTask,
	notFound
} from './task-moves.js';

/**
 * The parent task ID a dependency names: 5 for "5", "05" and "5.2". Null for
 * "5x" or "5.2x", which name nothing; parseInt read them as task 5
 */
function dependencyTaskId(dep: unknown): number | null {
	if (typeof dep === 'number') return Number.isFinite(dep) ? dep : null;
	if (typeof dep !== 'string') return null;
	const id = canonicalTaskId(dep);
	return id === undefined ? null : Number(id.split('.')[0]);
}

/**
 * Task IDs the tasks or their subtasks depend on, directly or through each
 * other, in the order found (depth first). A subtask ID such as "5.2" brings
 * its parent, 5, since subtasks move with their parent.
 */
function forwardDependencies(sources: Item[], tasks: Item[]): number[] {
	const found = new Set<number>();
	const seen = new Set<number>();
	const visit = (taskId: number | null, depth: number) => {
		if (taskId === null || depth >= 100 || seen.has(taskId)) return;
		seen.add(taskId);
		const task = findTask(tasks, taskId);
		if (!task) return;
		const deps: unknown[] = [
			...(task.dependencies ?? []),
			...(task.subtasks ?? []).flatMap((st: Item) =>
				(st.dependencies ?? [])
					.filter((dep: unknown) => dep != null)
					.map((dep: string | number) => resolveSubtaskDependency(task.id, dep))
			)
		];
		for (const dep of deps) {
			const id = dependencyTaskId(dep);
			if (id === null || id === taskId) continue;
			found.add(id);
			visit(id, depth + 1);
		}
	};
	for (const source of sources) visit(dependencyTaskId(source.id), 0);
	return [...found];
}

/**
 * Move tasks, with their subtasks, from one tag to another, keeping their
 * IDs where the target tag doesn't use them; a taken ID becomes the next
 * free one there. A dependency that would point back into the source tag
 * blocks the move unless `withDependencies` brings what they depend on along
 * or `ignoreDependencies` drops it. The target tag is created when missing.
 * @param tags - Every tag's tasks, in file order; changed in place
 * @param archivedIds - Archived task IDs of a tag
 */
export function moveTasksBetweenTags(
	tags: Map<string, Task[]>,
	taskIdsInput: string[],
	sourceTag: string,
	targetTag: string,
	options: CrossTagMoveOptions,
	archivedIds: (tag: string) => ReadonlySet<string>
): CrossTagMoveResult {
	// "02" is task 2, as everywhere else
	const taskIds = taskIdsInput.map(normalizeTaskId);
	const source = tags.get(sourceTag) as Item[] | undefined;
	if (!source) {
		fail(
			`Source tag "${sourceTag}" not found or invalid`,
			ERROR_CODES.NOT_FOUND
		);
	}
	if (!tags.has(targetTag)) {
		assertTagName(targetTag);
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
  taskgraph remove-task ${taskId} --convert`,
				ERROR_CODES.VALIDATION_ERROR,
				{ moveCode: MOVE_ERROR_CODES.CANNOT_MOVE_SUBTASK, taskId }
			);
		}
	}

	let toMove: DependencyId[] = taskIds;
	let ignored = false;
	if (options.withDependencies) {
		const sourceIds = new Set(source.map((t) => String(parseInt(t.id, 10))));
		const dependencies = forwardDependencies(sourceTasks, source).filter((id) =>
			sourceIds.has(String(id))
		);
		toMove = [...taskIds];
		for (const id of dependencies) {
			if (!toMove.some((m) => String(m) === String(id))) toMove.push(id);
		}
	}
	// IDs the moved tasks still name outside the move, which no renumbered
	// task may take
	const reserved = new Set<string>();
	// withDependencies brings only what the tasks depend on, so dependents
	// left behind and archived dependencies are still checked
	{
		const movedIds = new Set(toMove.map((id) => String(dependencyTaskId(id))));
		const isMoved = (id: DependencyId) => {
			const task = dependencyTaskId(id);
			return task !== null && movedIds.has(String(task));
		};
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
		// Every tag numbers from 1, so a dependency the source tag has, live or
		// archived, is that task, not the same ID elsewhere (#801). One it
		// doesn't have names nothing, and moves as it is unless the target tag
		// has that ID, which would make it name an unrelated task (#864).
		const liveInSource = liveOrArchived(source as Task[], new Set());
		const sourceArchived = archivedIds(sourceTag);
		const inTarget = liveOrArchived(target as Task[], () =>
			archivedIds(targetTag)
		);
		for (const { item, id, parentId } of holders) {
			const holderMoved = isMoved(id);
			const deps: unknown[] = [];
			for (const dep of item.dependencies ?? []) {
				if (dep == null) continue;
				// Older versions stored "1.01" as typed; it is 1.1 here too
				const full = normalizeTaskId(
					parentId === undefined
						? String(dep)
						: resolveSubtaskDependency(parentId, dep)
				);
				if (holderMoved && !isMoved(full)) {
					reserved.add(full.split('.')[0]);
					const live = liveInSource(full);
					const archived = !live && isArchivedReference(full, sourceArchived);
					const missing = !live && !archived && inTarget(full);
					if ((live || archived || missing) && sourceTag !== targetTag) {
						conflicts.push({
							taskId: id,
							dependencyId: dep,
							dependencyTag: sourceTag,
							message: missing
								? `Task ${id} depends on ${full}, which ${sourceTag} doesn't have (${targetTag} has a different ${full})`
								: `Task ${id} depends on ${full} (${archived ? 'archived ' : ''}in ${sourceTag})`,
							// withDependencies can't bring these along
							...(archived ? { archived: true } : {}),
							...(missing ? { missing: true } : {})
						});
					}
					const depTask = dependencyTaskId(full);
					if (
						live ||
						archived ||
						missing ||
						(depTask !== null && findTask(source, depTask))
					) {
						deps.push(dep);
					}
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

	// Each task keeps its ID unless the target tag uses it, live or archived;
	// then it takes the next free one there (#984). New IDs are above every ID
	// in use, so renaming one never touches another moved task's old ID.
	const inUse = new Set([
		...target.map((t) => String(t.id)),
		...archivedIds(targetTag),
		...reserved
	]);
	// "5,5" moves task 5 once
	toMove = toMove.filter(
		(taskId, i) =>
			toMove.findIndex(
				(other) => normalizeTaskId(other) === normalizeTaskId(taskId)
			) === i
	);
	const ids = toMove.map((taskId) => {
		const id = normalizeTaskId(taskId);
		if (!findTask(source, id)) {
			notFound(`Task ${taskId} not found in source tag "${sourceTag}"`);
		}
		return id;
	});
	const newIds = new Map<string, string>();
	for (const id of ids) {
		if (!inUse.has(id)) newIds.set(id, id);
		inUse.add(id);
	}
	for (const id of ids) {
		if (newIds.has(id)) continue;
		const next = String(nextTaskId(inUse));
		newIds.set(id, next);
		inUse.add(next);
	}

	const movedTasks: CrossTagMoveResult['movedTasks'] = [];
	const moved: Item[] = [];
	toMove.forEach((taskId, i) => {
		const index = source.findIndex((t) => String(t.id) === ids[i]);
		const [task] = source.splice(index, 1);
		task.metadata ??= {};
		task.metadata.moveHistory ??= [];
		task.metadata.moveHistory.push({
			fromTag: sourceTag,
			toTag: targetTag,
			timestamp: new Date().toISOString()
		});
		target.push(task);
		moved.push(task);
		movedTasks.push({
			id: taskId,
			newId: newIds.get(ids[i]) as string,
			fromTag: sourceTag,
			toTag: targetTag
		});
	});

	// Related and discovered-from links don't cross tags: the same ID names a
	// different task there. Moved tasks keep links among themselves; the
	// source tag drops its links to them. Pruned before renumbering, so a link
	// to an ID a moved task now takes isn't kept.
	pruneTaskLinks(moved, (id) => newIds.has(id.split('.')[0]));
	pruneTaskLinks(
		source,
		liveOrArchived(source as Task[], () => archivedIds(sourceTag))
	);

	// Dependencies and links among the moved tasks, and their subtasks'
	// references to their parent, follow the new IDs
	for (const task of moved) {
		const oldId = normalizeTaskId(task.id);
		const newId = newIds.get(oldId) as string;
		if (newId === oldId) continue;
		task.id = newId;
		retargetDependents(moved, oldId, newId);
		for (const subtask of task.subtasks ?? []) {
			if (subtask.parentId !== undefined) subtask.parentId = newId;
			retargetDependents(
				moved,
				`${oldId}.${subtask.id}`,
				`${newId}.${subtask.id}`
			);
		}
	}

	const result: CrossTagMoveResult = {
		message: `Successfully moved ${movedTasks.length} tasks from "${sourceTag}" to "${targetTag}"`,
		movedTasks
	};
	if (ignored) {
		result.tips = [
			'Run "taskgraph fix-dependencies --check" to check for dependency issues.',
			'Run "taskgraph fix-dependencies" to automatically repair dangling dependencies.'
		];
	}
	return result;
}
