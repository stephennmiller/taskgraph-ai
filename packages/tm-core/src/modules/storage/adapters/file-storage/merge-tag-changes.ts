/**
 * @fileoverview Three-way merge for one tag of tasks.json.
 *
 * A command that reads the tasks, waits (on a model, for example) and then
 * saves must not undo what other commands saved in the meantime. Given the
 * tag as the command read it (`base`), as the command wants to save it
 * (`mine`) and as it is in the file now (`theirs`), keep everything in
 * `theirs` and apply only what the command itself changed.
 *
 * - A field the command didn't change keeps its current value.
 * - A field the command changed takes the command's value, also when someone
 *   else changed it too.
 * - Lists of items with an `id` (tasks, subtasks) merge item by item: items
 *   others added stay, items the command removed go, items the command added
 *   are appended. When someone else took the ID of an item the command added,
 *   the command's item gets the next free ID and is reported in `renumbered`.
 *   Dependencies on a renumbered item, their provenance marks and
 *   non-blocking links follow it.
 * - When the command reordered items it kept, its order wins; items others
 *   added stay after the item they followed.
 * - An item someone else removed stays removed.
 */

import { isDeepStrictEqual } from 'node:util';
import { resolveSubtaskDependency } from '../../../dependencies/subtask-dependency.js';
import {
	DEPENDENCY_SOURCES_KEY,
	TASK_LINKS_KEY
} from '../../../dependencies/dependency-provenance.js';
import { own, put } from './own-key.js';

export interface RenumberedItem {
	/** The ID the command gave the item, such as `11` or `5.3` */
	from: string;
	/** The ID it was saved under */
	to: string;
}

export interface MergeTagChangesResult<T> {
	merged: T;
	renumbered: RenumberedItem[];
}

type Item = Record<string, unknown> & { id: unknown };

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === 'object' && !Array.isArray(value);

const isItemList = (value: unknown): value is Item[] =>
	Array.isArray(value) &&
	value.every(
		(item) => isPlainObject(item) && item.id !== undefined && item.id !== null
	);

const keyOf = (item: Item) => String(item.id);

const same = (a: unknown, b: unknown) => isDeepStrictEqual(a, b);

/**
 * Apply the changes between `base` and `mine` to `theirs`.
 *
 * @param base - The tag as the command read it
 * @param mine - The tag as the command wants to save it
 * @param theirs - The tag as it is in the file now
 */
export function mergeTagChanges<T>(
	base: unknown,
	mine: T,
	theirs: unknown
): MergeTagChangesResult<T> {
	const renumbered: RenumberedItem[] = [];
	const merged = mergeValue(base, mine, theirs, '', renumbered) as T;
	return { merged, renumbered };
}

function mergeValue(
	base: unknown,
	mine: unknown,
	theirs: unknown,
	scope: string,
	renumbered: RenumberedItem[]
): unknown {
	if (same(base, mine)) return theirs;
	if (same(base, theirs) || same(mine, theirs)) return mine;
	if (isPlainObject(base) && isPlainObject(mine) && isPlainObject(theirs)) {
		return mergeObjects(base, mine, theirs, scope, renumbered);
	}
	if (isItemList(base) && isItemList(mine) && isItemList(theirs)) {
		return mergeItemLists(base, mine, theirs, scope, renumbered);
	}
	return mine;
}

function mergeObjects(
	base: Record<string, unknown>,
	mine: Record<string, unknown>,
	theirs: Record<string, unknown>,
	scope: string,
	renumbered: RenumberedItem[]
): Record<string, unknown> {
	// The subtasks of task 5 are reported as 5.<id>
	const mineId = own(mine, 'id');
	const childScope =
		mineId !== undefined && mineId !== null ? `${scope}${mineId}.` : scope;
	const keys = new Set([
		...Object.keys(theirs),
		...Object.keys(mine),
		...Object.keys(base)
	]);
	const result: Record<string, unknown> = {};
	for (const key of keys) {
		const value = mergeValue(
			own(base, key),
			own(mine, key),
			own(theirs, key),
			childScope,
			renumbered
		);
		if (value !== undefined) put(result, key, value);
	}
	return result;
}

/** Whether `mine` lists the items it kept from `base` in another order */
function isReordered(base: Item[], mine: Item[]): boolean {
	const mineKeys = new Set(mine.map(keyOf));
	const baseKeys = new Set(base.map(keyOf));
	const baseOrder = base.map(keyOf).filter((key) => mineKeys.has(key));
	const mineOrder = mine.map(keyOf).filter((key) => baseKeys.has(key));
	return !same(baseOrder, mineOrder);
}

function mergeItemLists(
	base: Item[],
	mine: Item[],
	theirs: Item[],
	scope: string,
	renumbered: RenumberedItem[]
): Item[] {
	const baseById = new Map(base.map((item) => [keyOf(item), item]));
	const mineById = new Map(mine.map((item) => [keyOf(item), item]));
	const theirsById = new Map(theirs.map((item) => [keyOf(item), item]));

	// Items as they are now, with the command's changes applied, in their order
	const current: Item[] = [];
	const kept = new Map<string, Item>();
	for (const now of theirs) {
		const key = keyOf(now);
		const original = baseById.get(key);
		if (original === undefined) {
			// Added by someone else
			current.push(now);
			continue;
		}
		const ours = mineById.get(key);
		// Removed by the command
		if (ours === undefined) continue;
		const merged = mergeValue(original, ours, now, scope, renumbered) as Item;
		current.push(merged);
		kept.set(key, merged);
	}

	// Items the command added, under a free ID when someone else took theirs
	const taken = new Set(current.map(keyOf));
	const newIds = new Map<string, unknown>();
	const ownAdded = new Map<string, Item>();
	let nextId = nextFreeId([
		...current,
		...mine.filter((item) => !baseById.has(keyOf(item)))
	]);
	for (const item of mine) {
		const key = keyOf(item);
		if (baseById.has(key)) continue;
		if (!taken.has(key)) {
			ownAdded.set(key, item);
			taken.add(key);
			continue;
		}
		// Someone else added the same item under the same ID
		if (same(item, theirsById.get(key))) continue;
		const id = typeof item.id === 'number' ? nextId : String(nextId);
		nextId++;
		newIds.set(key, id);
		renumbered.push({ from: `${scope}${key}`, to: `${scope}${id}` });
		ownAdded.set(key, { ...item, id });
		taken.add(String(id));
	}

	if (newIds.size > 0) {
		for (const [key, item] of ownAdded) {
			ownAdded.set(key, followRenumbered(item, scope, newIds));
		}
	}

	if (!isReordered(base, mine)) {
		return [...current, ...ownAdded.values()];
	}

	// The command reordered its items: follow its order, and keep each item
	// others added after the item it followed
	const following = new Map<string | null, Item[]>();
	let anchor: string | null = null;
	for (const item of current) {
		const key = keyOf(item);
		if (kept.has(key)) {
			anchor = key;
			continue;
		}
		following.set(anchor, [...(following.get(anchor) ?? []), item]);
	}
	const result: Item[] = [...(following.get(null) ?? [])];
	for (const item of mine) {
		const key = keyOf(item);
		const placed = kept.get(key) ?? ownAdded.get(key);
		if (placed === undefined) continue;
		result.push(placed);
		if (kept.has(key)) result.push(...(following.get(key) ?? []));
	}
	return result;
}

/**
 * Point an added item's dependencies (and those of its subtasks) at the new
 * IDs of renumbered items, keeping the form each one was stored in, and move
 * their provenance marks along.
 *
 * @param scope - `''` for tasks, `'<parent>.'` for the subtasks of a task
 * @param newIds - Renumbered items in this list, by their old key
 */
function followRenumbered(
	item: Item,
	scope: string,
	newIds: Map<string, unknown>
): Item {
	// A full ID in this list's scope, such as "11", "11.2" or "5.3"
	const remap = (fullId: string): string => {
		if (!fullId.startsWith(scope)) return fullId;
		const [head, ...rest] = fullId.slice(scope.length).split('.');
		if (!newIds.has(head)) return fullId;
		return [`${scope}${String(newIds.get(head))}`, ...rest].join('.');
	};

	const parentOf = scope === '' ? undefined : scope.slice(0, -1);
	const fixed = rewriteDependencies(item, parentOf, remap);

	// The subtasks of an added task name siblings relative to its old ID
	if (scope === '' && isItemList(fixed.subtasks)) {
		const oldParent = keyOf(item);
		fixed.subtasks = fixed.subtasks.map((subtask) =>
			rewriteDependencies(subtask, oldParent, remap)
		);
	}
	return fixed;
}

function rewriteDependencies(
	item: Item,
	parentId: string | undefined,
	remap: (fullId: string) => string
): Item {
	const result: Item = { ...item };
	const dependencies = own(item, 'dependencies');
	if (Array.isArray(dependencies)) {
		result.dependencies = dependencies.map((dep) => {
			if (typeof dep !== 'number' && typeof dep !== 'string') return dep;
			const full =
				parentId === undefined
					? String(dep)
					: resolveSubtaskDependency(parentId, dep);
			const moved = remap(full);
			if (moved === full) return dep;
			if (typeof dep === 'string') return moved;
			// A bare number names a task, or a sibling of a subtask
			return Number(moved.split('.').pop());
		});
	}
	const metadata = own(item, 'metadata');
	if (isPlainObject(metadata)) {
		// Both maps are keyed by full ID
		let movedMetadata: Record<string, unknown> | undefined;
		for (const mapKey of [DEPENDENCY_SOURCES_KEY, TASK_LINKS_KEY]) {
			const entries = own(metadata, mapKey);
			if (!isPlainObject(entries)) continue;
			const moved: Record<string, unknown> = {};
			for (const [key, value] of Object.entries(entries)) {
				put(moved, remap(key), value);
			}
			movedMetadata ??= { ...metadata };
			put(movedMetadata, mapKey, moved);
		}
		if (movedMetadata) result.metadata = movedMetadata;
	}
	return result;
}

function nextFreeId(items: Item[]): number {
	let max = 0;
	for (const item of items) {
		const id = Number(item.id);
		if (Number.isInteger(id) && id > max) max = id;
	}
	return max + 1;
}
