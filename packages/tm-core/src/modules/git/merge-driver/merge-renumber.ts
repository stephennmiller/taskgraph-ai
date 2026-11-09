/**
 * @fileoverview The renumbering step of the tasks.json merge: incoming items
 * whose IDs this branch also used get the next free ID, and every incoming
 * reference follows (see merge-tasks-json.ts for the rules).
 */

import {
	DEPENDENCY_SOURCES_KEY,
	TASK_LINKS_KEY
} from '../../dependencies/dependency-provenance.js';
import {
	isSiblingReference,
	resolveSubtaskDependency
} from '../../dependencies/subtask-dependency.js';
import {
	type archivedTasksById,
	highestTaskId
} from '../../tasks/utils/archive.js';
import {
	type Item,
	type Json,
	byKey,
	isItemList,
	isObject,
	keyOf,
	own,
	put,
	same,
	withIdType
} from './merge-json-utils.js';

/** An incoming task or subtask that was given a new ID */
export interface MergeRenumbered {
	tag: string;
	/** The ID on the incoming branch, such as `11` or `5.3` */
	from: string;
	/** The ID in the merged file */
	to: string;
}

interface RenumberContext {
	tag: string;
	renumbered: MergeRenumbered[];
	archived: ReturnType<typeof archivedTasksById>;
}

/**
 * Give incoming items whose IDs ours also used for a different new item the
 * next free ID, and point every incoming reference at the new IDs.
 */
export function renumberIncoming(
	base: Json,
	ours: Json,
	theirs: Json,
	ctx: RenumberContext
): Json {
	const baseTasks = own(base, 'tasks');
	const ourTasks = own(ours, 'tasks');
	const theirTasks = own(theirs, 'tasks');
	if (!isItemList(ourTasks) || !isItemList(theirTasks)) return theirs;
	const baseList = isItemList(baseTasks) ? baseTasks : [];

	const baseById = byKey(baseList);
	const oursById = byKey(ourTasks);
	const moves = new Map<string, string>();

	// New tasks on both sides under one ID, or incoming under an archived ID
	// or one this branch used and removed since the base (#1040)
	const baseHighest = highestTaskId(base);
	const ourHighest = highestTaskId(ours);
	let nextTask =
		Math.max(
			maxId([baseList, ourTasks, theirTasks]),
			ctx.archived.highestId,
			ourHighest,
			highestTaskId(theirs)
		) + 1;
	for (const task of theirTasks) {
		const key = keyOf(task);
		if (baseById.has(key)) continue;
		if (oursById.has(key)) {
			if (same(task, oursById.get(key))) continue;
		} else if (
			!(Number(key) > baseHighest && Number(key) <= ourHighest) &&
			// The archived task itself, restored on that branch
			(!ctx.archived.tasks.has(key) ||
				isArchivedTask(task, ctx.archived.tasks.get(key)))
		) {
			continue;
		}
		moves.set(key, String(nextTask++));
	}

	// New subtasks on both sides of a task they both kept
	for (const task of theirTasks) {
		const key = keyOf(task);
		const baseTask = baseById.get(key);
		const ourTask = oursById.get(key);
		if (!baseTask || !ourTask) continue;
		const theirSubs = own(task, 'subtasks');
		const ourSubs = own(ourTask, 'subtasks');
		if (!isItemList(theirSubs) || !isItemList(ourSubs)) continue;
		const baseSubs = own(baseTask, 'subtasks');
		const baseSubList = isItemList(baseSubs) ? baseSubs : [];
		const baseSubIds = byKey(baseSubList);
		const ourSubIds = byKey(ourSubs);
		let nextSub = maxId([baseSubList, ourSubs, theirSubs]) + 1;
		for (const sub of theirSubs) {
			const subKey = keyOf(sub);
			if (baseSubIds.has(subKey) || !ourSubIds.has(subKey)) continue;
			if (same(sub, ourSubIds.get(subKey))) continue;
			moves.set(`${key}.${subKey}`, `${key}.${nextSub++}`);
		}
	}

	if (moves.size === 0) return theirs;
	for (const [from, to] of moves) {
		ctx.renumbered.push({ tag: ctx.tag, from, to });
	}

	// A full ID ("11", "11.2", "5.3") as it reads after the moves
	const remap = (fullId: string): string => {
		const direct = moves.get(fullId);
		if (direct !== undefined) return direct;
		const [head, ...rest] = fullId.split('.');
		const parent = moves.get(head);
		return parent === undefined ? fullId : [parent, ...rest].join('.');
	};

	const tasks = theirTasks.map((task) => {
		const oldKey = keyOf(task);
		const newKey = remap(oldKey);
		const moved: Item = { ...task };
		if (newKey !== oldKey) moved.id = withIdType(task.id, Number(newKey));
		rewriteReferences(moved, undefined, undefined, remap);

		const subtasks = own(task, 'subtasks');
		if (isItemList(subtasks)) {
			moved.subtasks = subtasks.map((sub) => {
				const oldFull = `${oldKey}.${keyOf(sub)}`;
				const newFull = remap(oldFull);
				const movedSub: Item = { ...sub };
				const newSubId = Number(newFull.split('.').pop());
				if (newFull !== `${newKey}.${keyOf(sub)}`) {
					movedSub.id = withIdType(sub.id, newSubId);
				}
				const parentId = own(sub, 'parentId');
				if (
					parentId !== undefined &&
					String(parentId) === oldKey &&
					newKey !== oldKey
				) {
					movedSub.parentId = withIdType(parentId, Number(newKey));
				}
				rewriteReferences(movedSub, oldKey, newKey, remap);
				return movedSub;
			});
		}
		return moved;
	});

	const result: Json = { ...theirs };
	put(result, 'tasks', tasks);
	return result;
}

/**
 * Rewrite one task's or subtask's dependencies and provenance keys in place.
 *
 * @param oldParent - For a subtask, its task's ID before the moves
 * @param newParent - ...and after
 */
function rewriteReferences(
	item: Item,
	oldParent: string | undefined,
	newParent: string | undefined,
	remap: (fullId: string) => string
): void {
	const dependencies = own(item, 'dependencies');
	if (Array.isArray(dependencies)) {
		item.dependencies = dependencies.map((dep) => {
			if (typeof dep !== 'number' && typeof dep !== 'string') return dep;
			const full =
				oldParent === undefined
					? String(dep)
					: resolveSubtaskDependency(oldParent, dep);
			const moved = remap(full);
			if (moved === full) return dep;
			if (typeof dep === 'string') return moved;
			const parts = moved.split('.');
			if (oldParent !== undefined && isSiblingReference(dep)) {
				// A sibling stays a sibling number when it's still a sibling
				return parts.length === 2 && parts[0] === newParent
					? Number(parts[1])
					: moved;
			}
			return parts.length === 1 ? Number(moved) : moved;
		});
	}

	const metadata = own(item, 'metadata');
	if (!isObject(metadata)) return;
	// Provenance marks and non-blocking links are both keyed by full ID
	let movedMetadata: Json | undefined;
	for (const mapKey of [DEPENDENCY_SOURCES_KEY, TASK_LINKS_KEY]) {
		const entries = own(metadata, mapKey);
		if (!isObject(entries)) continue;
		const moved: Json = {};
		for (const [key, value] of Object.entries(entries)) {
			put(moved, remap(key), value);
		}
		movedMetadata ??= { ...metadata };
		put(movedMetadata, mapKey, moved);
	}
	if (movedMetadata) item.metadata = movedMetadata;
}

/**
 * Whether an incoming task under an archived ID is that task, restored. Any
 * command after the restore changes `updatedAt` or the status, so identity
 * is when it was created and its title (#1094); a different task that
 * reused the ID has another creation time. Tasks from before `createdAt`
 * was recorded count only when nothing else changed either.
 */
function isArchivedTask(task: Item, archived: unknown): boolean {
	if (same(task, archived)) return true;
	const createdAt = own(task, 'createdAt');
	return (
		isObject(archived) &&
		typeof createdAt === 'string' &&
		createdAt === own(archived, 'createdAt') &&
		own(task, 'title') === own(archived, 'title')
	);
}

function maxId(lists: Item[][]): number {
	let max = 0;
	for (const list of lists) {
		for (const item of list) {
			const id = Number(item.id);
			if (Number.isInteger(id) && id > max) max = id;
		}
	}
	return max;
}
