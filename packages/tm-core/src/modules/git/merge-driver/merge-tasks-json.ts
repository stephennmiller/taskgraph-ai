/**
 * @fileoverview Three-way merge of tasks.json for the Git merge driver.
 *
 * Two branches that both add a task both call it the next free ID, so a plain
 * text merge of tasks.json conflicts (or, worse, silently interleaves two
 * tasks). This merges the file as data instead, tag by tag:
 *
 * - Changes either branch made to existing tasks are kept. A field changed
 *   only on one side takes that side's value.
 * - New tasks (and new subtasks of an existing task) that both branches gave
 *   the same ID are kept twice: the incoming branch's item (`theirs`) gets
 *   the next free ID and is reported in `renumbered`. Every reference to it
 *   on the incoming side follows: dependencies of tasks and subtasks (in the
 *   form each was stored: a number, a string, or a sibling number),
 *   `metadata.dependencySources` keys and a subtask's `parentId`.
 * - The same field changed to different values on both sides is a conflict.
 *   The current branch's value (`ours`) is written, and the conflict is
 *   reported with the incoming value, so the caller can exit non-zero and
 *   git marks the file as conflicted. Nothing is dropped: the incoming value
 *   is in the report and in git's index (`git show :3:<path>`).
 *   Exceptions that merge cleanly: timestamps (`updatedAt`, `updated`,
 *   `lastModified`) take the later one, `created`/`createdAt` the earlier, `schemaVersion` the higher one,
 *   lists of plain values (dependencies, tags) take both sides' additions
 *   and removals, `details` that both sides appended to keeps both
 *   appendices, and a tag's `taskCount`/`completedCount` are recounted.
 * - A task removed on one side and changed on the other is kept, as a
 *   conflict. Removed on one side and untouched on the other, it goes.
 *
 * The function is pure: parsed JSON in, merged JSON out. See
 * `merge-driver-files.ts` for the file I/O git's driver protocol needs.
 */

import { isDeepStrictEqual } from 'node:util';
import { DEPENDENCY_SOURCES_KEY } from '../../dependencies/dependency-provenance.js';
import {
	isSiblingReference,
	resolveSubtaskDependency
} from '../../dependencies/subtask-dependency.js';

/** An incoming task or subtask that was given a new ID */
export interface MergeRenumbered {
	tag: string;
	/** The ID on the incoming branch, such as `11` or `5.3` */
	from: string;
	/** The ID in the merged file */
	to: string;
}

/** A change the merge couldn't combine; the current branch's side was kept */
export interface MergeConflict {
	tag: string;
	/** Task or subtask ID; absent for the tag itself or its metadata */
	id?: string;
	/**
	 * Dotted path of the field inside the task (`status`, `metadata.owner`),
	 * or `''` when the whole task or tag was removed on one side
	 */
	field: string;
	/**
	 * `changed-both`: both sides set different values.
	 * `removed-ours` / `removed-theirs`: that side removed the task (or tag)
	 * and the other changed it, so it was kept.
	 */
	kind: 'changed-both' | 'removed-ours' | 'removed-theirs';
	ours: unknown;
	theirs: unknown;
}

export interface TasksMergeResult {
	/** The merged tasks.json content, ready to serialize */
	merged: unknown;
	renumbered: MergeRenumbered[];
	conflicts: MergeConflict[];
}

type Json = Record<string, unknown>;
type Item = Json & { id: unknown };

/** Timestamps where both sides moving forward is not a conflict: later wins */
const LATEST_FIELDS = new Set(['updatedAt', 'updated', 'lastModified']);
/** Creation times two writers both filled in: earlier wins */
const EARLIEST_FIELDS = new Set(['createdAt', 'created']);
/** Tag metadata counts that are recomputed from the merged tasks */
const DERIVED_COUNT_FIELDS = new Set(['taskCount', 'completedCount']);
/** Text fields that commands append notes to (update-subtask) */
const APPEND_FIELDS = new Set(['details']);
/** The tag a legacy `{ "tasks": [...] }` file is read as */
const LEGACY_TAG = 'master';

const same = (a: unknown, b: unknown) => isDeepStrictEqual(a, b);

const isObject = (value: unknown): value is Json =>
	value !== null && typeof value === 'object' && !Array.isArray(value);

const isItemList = (value: unknown): value is Item[] =>
	Array.isArray(value) &&
	value.every(
		(item) => isObject(item) && item.id !== undefined && item.id !== null
	);

const isPrimitiveList = (value: unknown): value is unknown[] =>
	Array.isArray(value) &&
	value.every((item) => item === null || typeof item !== 'object');

const keyOf = (item: Item) => String(item.id);

/** Own property only, so keys such as `constructor` never read the prototype */
const own = (object: Json | undefined, key: string): unknown =>
	object && Object.hasOwn(object, key) ? object[key] : undefined;

/** Define an own property, so a `__proto__` key stays data */
const put = (object: Json, key: string, value: unknown) => {
	Object.defineProperty(object, key, {
		value,
		enumerable: true,
		writable: true,
		configurable: true
	});
};

const byKey = (items: Item[] | undefined) =>
	new Map((items ?? []).map((item) => [keyOf(item), item]));

/** Keep the ID's JSON type: a number stays a number */
const withIdType = (original: unknown, id: number) =>
	typeof original === 'number' ? id : String(id);

interface Context {
	tag: string;
	renumbered: MergeRenumbered[];
	conflicts: MergeConflict[];
}

/**
 * Merge three versions of tasks.json.
 *
 * @param base - The common ancestor (`%O`); `undefined` or `{}` when the
 *   file didn't exist there
 * @param ours - The current branch (`%A`)
 * @param theirs - The branch being merged in (`%B`)
 */
export function mergeTasksJson(
	base: unknown,
	ours: unknown,
	theirs: unknown
): TasksMergeResult {
	const renumbered: MergeRenumbered[] = [];
	const conflicts: MergeConflict[] = [];

	const b = asTagged(base);
	const o = asTagged(ours);
	const t = asTagged(theirs);

	const merged: Json = {};
	const tags = [...new Set([...Object.keys(o.tags), ...Object.keys(t.tags)])];
	for (const tag of tags) {
		const ctx: Context = { tag, renumbered, conflicts };
		const value = mergeTag(
			own(b.tags, tag),
			own(o.tags, tag),
			own(t.tags, tag),
			ctx
		);
		if (value !== undefined) put(merged, tag, value);
	}

	// Write the legacy shape only when neither side had moved on from it
	const legacy = o.legacy && (t.legacy || Object.keys(t.tags).length === 0);
	if (legacy && Object.keys(merged).length === 1 && own(merged, LEGACY_TAG)) {
		return { merged: own(merged, LEGACY_TAG), renumbered, conflicts };
	}
	return { merged, renumbered, conflicts };
}

/** Read a file's content as tags; a legacy file is one `master` tag */
function asTagged(doc: unknown): { tags: Json; legacy: boolean } {
	if (!isObject(doc)) return { tags: {}, legacy: false };
	if (Array.isArray(own(doc, 'tasks'))) {
		const tags: Json = {};
		put(tags, LEGACY_TAG, doc);
		return { tags, legacy: true };
	}
	return { tags: doc, legacy: false };
}

function mergeTag(
	base: unknown,
	ours: unknown,
	theirs: unknown,
	ctx: Context
): unknown {
	if (ours === undefined && theirs === undefined) return undefined;
	if (base !== undefined && (ours === undefined || theirs === undefined)) {
		// One side removed the tag
		const kept = ours ?? theirs;
		if (same(base, kept)) return undefined;
		ctx.conflicts.push({
			tag: ctx.tag,
			field: '',
			kind: ours === undefined ? 'removed-ours' : 'removed-theirs',
			ours,
			theirs
		});
		return kept;
	}
	if (ours === undefined) return theirs;
	if (theirs === undefined) return ours;
	if (same(ours, theirs)) return ours;

	// Both sides have the tag; a tag both added merges against an empty one
	const baseTag = base ?? (isObject(ours) && isObject(theirs) ? {} : base);
	if (!isObject(baseTag) || !isObject(ours) || !isObject(theirs)) {
		return mergeField(baseTag, ours, theirs, '', undefined, ctx);
	}

	const incoming = renumberIncoming(baseTag, ours, theirs, ctx);
	const merged = mergeObject(baseTag, ours, incoming, '', undefined, ctx);
	recount(merged);
	return merged;
}

/**
 * Give incoming items whose IDs ours also used for a different new item the
 * next free ID, and point every incoming reference at the new IDs.
 */
function renumberIncoming(
	base: Json,
	ours: Json,
	theirs: Json,
	ctx: Context
): Json {
	const baseTasks = own(base, 'tasks');
	const ourTasks = own(ours, 'tasks');
	const theirTasks = own(theirs, 'tasks');
	if (!isItemList(ourTasks) || !isItemList(theirTasks)) return theirs;
	const baseList = isItemList(baseTasks) ? baseTasks : [];

	const baseById = byKey(baseList);
	const oursById = byKey(ourTasks);
	const moves = new Map<string, string>();

	// New tasks on both sides under the same ID
	let nextTask = maxId([baseList, ourTasks, theirTasks]) + 1;
	for (const task of theirTasks) {
		const key = keyOf(task);
		if (baseById.has(key) || !oursById.has(key)) continue;
		if (same(task, oursById.get(key))) continue;
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
	const sources = isObject(metadata)
		? own(metadata, DEPENDENCY_SOURCES_KEY)
		: undefined;
	if (isObject(metadata) && isObject(sources)) {
		const movedSources: Json = {};
		for (const [key, value] of Object.entries(sources)) {
			put(movedSources, remap(key), value);
		}
		const movedMetadata: Json = { ...metadata };
		put(movedMetadata, DEPENDENCY_SOURCES_KEY, movedSources);
		item.metadata = movedMetadata;
	}
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

/**
 * Merge one value.
 *
 * @param path - Dotted path of the field inside the current task, for reports
 * @param id - Full ID of the task or subtask the value belongs to
 */
function mergeField(
	base: unknown,
	ours: unknown,
	theirs: unknown,
	path: string,
	id: string | undefined,
	ctx: Context
): unknown {
	if (same(ours, theirs)) return ours;
	if (same(base, ours)) return theirs;
	if (same(base, theirs)) return ours;

	const field = path.split('.').pop() ?? '';

	if (typeof ours === 'string' && typeof theirs === 'string') {
		const later = Date.parse(theirs) > Date.parse(ours);
		if (LATEST_FIELDS.has(field)) return later ? theirs : ours;
		if (EARLIEST_FIELDS.has(field)) return later ? ours : theirs;
	}
	if (
		field === 'schemaVersion' &&
		typeof ours === 'number' &&
		typeof theirs === 'number'
	) {
		return Math.max(ours, theirs);
	}
	if (id === undefined && DERIVED_COUNT_FIELDS.has(field)) return ours;

	if (isObject(ours) && isObject(theirs)) {
		return mergeObject(isObject(base) ? base : {}, ours, theirs, path, id, ctx);
	}
	if (isItemList(ours) && isItemList(theirs)) {
		return mergeItems(isItemList(base) ? base : [], ours, theirs, id, ctx);
	}
	if (isPrimitiveList(ours) && isPrimitiveList(theirs)) {
		return mergePrimitiveList(isPrimitiveList(base) ? base : [], ours, theirs);
	}
	if (
		APPEND_FIELDS.has(field) &&
		typeof base === 'string' &&
		base !== '' &&
		typeof ours === 'string' &&
		typeof theirs === 'string' &&
		ours.startsWith(base) &&
		theirs.startsWith(base)
	) {
		return ours + theirs.slice(base.length);
	}

	ctx.conflicts.push({
		tag: ctx.tag,
		...(id !== undefined ? { id } : {}),
		field: path,
		kind: 'changed-both',
		ours,
		theirs
	});
	// A field ours removed and theirs changed keeps theirs' value
	return ours === undefined ? theirs : ours;
}

function mergeObject(
	base: Json,
	ours: Json,
	theirs: Json,
	path: string,
	id: string | undefined,
	ctx: Context
): Json {
	const keys = [
		...new Set([
			...Object.keys(ours),
			...Object.keys(theirs),
			...Object.keys(base)
		])
	];
	const result: Json = {};
	for (const key of keys) {
		const value = mergeField(
			own(base, key),
			own(ours, key),
			own(theirs, key),
			path === '' ? key : `${path}.${key}`,
			id,
			ctx
		);
		if (value !== undefined) put(result, key, value);
	}
	return result;
}

/**
 * Merge a list of tasks (at a tag's `tasks`) or subtasks (inside a task),
 * item by item. The current branch's order comes first; items only the
 * incoming branch added follow, in ID order.
 */
function mergeItems(
	base: Item[],
	ours: Item[],
	theirs: Item[],
	parentId: string | undefined,
	ctx: Context
): Item[] {
	const baseById = byKey(base);
	const oursById = byKey(ours);
	const theirsById = byKey(theirs);
	const fullId = (key: string) =>
		parentId === undefined ? key : `${parentId}.${key}`;
	const result: Item[] = [];

	const removed = (key: string, kept: Item, side: 'ours' | 'theirs') => {
		if (same(baseById.get(key), kept)) return;
		ctx.conflicts.push({
			tag: ctx.tag,
			id: fullId(key),
			field: '',
			kind: side === 'ours' ? 'removed-ours' : 'removed-theirs',
			ours: side === 'ours' ? undefined : kept,
			theirs: side === 'theirs' ? undefined : kept
		});
		result.push(kept);
	};

	for (const item of ours) {
		const key = keyOf(item);
		const original = baseById.get(key);
		const incoming = theirsById.get(key);
		if (original === undefined || incoming === undefined) {
			if (original !== undefined) removed(key, item, 'theirs');
			// Added here (renumbering left only identical twins)
			else result.push(item);
			continue;
		}
		// Items are scoped by ID: a field path starts again inside each one
		result.push(
			mergeObject(original, item, incoming, '', fullId(key), ctx) as Item
		);
	}
	const added: Item[] = [];
	for (const item of theirs) {
		const key = keyOf(item);
		if (oursById.has(key)) continue;
		if (baseById.has(key)) removed(key, item, 'ours');
		else added.push(item);
	}
	// In ID order, so a renumbered item doesn't sit after its higher-ID siblings
	return [...result, ...added.sort(byNumericId)];
}

/** Numeric IDs ascending; anything else keeps its place (stable sort) */
function byNumericId(a: Item, b: Item): number {
	const x = Number(a.id);
	const y = Number(b.id);
	return Number.isFinite(x) && Number.isFinite(y) ? x - y : 0;
}

/**
 * Both sides' additions and removals; the current branch's order, then
 * values only the incoming branch added.
 */
function mergePrimitiveList(
	base: unknown[],
	ours: unknown[],
	theirs: unknown[]
): unknown[] {
	const has = (list: unknown[], value: unknown) =>
		list.some((entry) => same(entry, value));
	const result = ours.filter(
		(value) => !(has(base, value) && !has(theirs, value))
	);
	for (const value of theirs) {
		if (!has(base, value) && !has(result, value)) result.push(value);
	}
	return result;
}

/** Recount a tag's `taskCount`/`completedCount` when it stores them */
function recount(tag: Json): void {
	const tasks = own(tag, 'tasks');
	const metadata = own(tag, 'metadata');
	if (!Array.isArray(tasks) || !isObject(metadata)) return;
	const counted: Json = { ...metadata };
	if (typeof own(metadata, 'taskCount') === 'number') {
		counted.taskCount = tasks.length;
	}
	if (typeof own(metadata, 'completedCount') === 'number') {
		counted.completedCount = tasks.filter(
			(task) => isObject(task) && task.status === 'done'
		).length;
	}
	put(tag, 'metadata', counted);
}
