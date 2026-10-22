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
 * - An item someone else removed stays removed.
 */

import { isDeepStrictEqual } from 'node:util';

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
	const childScope =
		mine.id !== undefined && mine.id !== null ? `${scope}${mine.id}.` : scope;
	const keys = new Set([
		...Object.keys(theirs),
		...Object.keys(mine),
		...Object.keys(base)
	]);
	const result: Record<string, unknown> = {};
	for (const key of keys) {
		const value = mergeValue(
			base[key],
			mine[key],
			theirs[key],
			childScope,
			renumbered
		);
		if (value !== undefined) result[key] = value;
	}
	return result;
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

	const result: Item[] = [];
	for (const current of theirs) {
		const key = keyOf(current);
		const original = baseById.get(key);
		if (original === undefined) {
			// Added by someone else
			result.push(current);
			continue;
		}
		const ours = mineById.get(key);
		// Removed by the command
		if (ours === undefined) continue;
		result.push(mergeValue(original, ours, current, scope, renumbered) as Item);
	}

	const added = mine.filter((item) => !baseById.has(keyOf(item)));
	const taken = new Set(result.map(keyOf));
	const newIds = new Map<string, unknown>();
	const ownAdded = new Set<Item>();
	let nextId = nextFreeId([...result, ...added]);
	for (const item of added) {
		const key = keyOf(item);
		if (!taken.has(key)) {
			result.push(item);
			ownAdded.add(item);
			taken.add(key);
			continue;
		}
		// Someone else added the same item under the same ID
		if (same(item, theirsById.get(key))) continue;
		const id = typeof item.id === 'number' ? nextId : String(nextId);
		nextId++;
		newIds.set(key, id);
		renumbered.push({ from: `${scope}${key}`, to: `${scope}${id}` });
		const moved = { ...item, id };
		result.push(moved);
		ownAdded.add(moved);
		taken.add(String(id));
	}

	// Items the command added may depend on each other by their old IDs
	if (newIds.size > 0) {
		return result.map((item) => {
			if (!ownAdded.has(item) || !Array.isArray(item.dependencies)) {
				return item;
			}
			return {
				...item,
				dependencies: item.dependencies.map((dep) =>
					newIds.has(String(dep))
						? typeof dep === 'number'
							? Number(newIds.get(String(dep)))
							: String(newIds.get(String(dep)))
						: dep
				)
			};
		});
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
