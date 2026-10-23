/**
 * @fileoverview JSON helpers the tasks.json and archive.json merges share
 */

import { isDeepStrictEqual } from 'node:util';

export type Json = Record<string, unknown>;
export type Item = Json & { id: unknown };

export const same = (a: unknown, b: unknown) => isDeepStrictEqual(a, b);

export const isObject = (value: unknown): value is Json =>
	value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * A list of tasks or subtasks: objects with unique number or string IDs.
 * Anything else (a duplicate ID from a bad hand merge, an object as an ID)
 * isn't merged item by item, so a clash in it is reported, never collapsed.
 */
export const isItemList = (value: unknown): value is Item[] => {
	if (!Array.isArray(value)) return false;
	const seen = new Set<string>();
	for (const item of value) {
		if (!isObject(item)) return false;
		const id = own(item, 'id');
		if (typeof id !== 'number' && typeof id !== 'string') return false;
		if (seen.has(String(id))) return false;
		seen.add(String(id));
	}
	return true;
};

export const isPrimitiveList = (value: unknown): value is unknown[] =>
	Array.isArray(value) &&
	value.every((item) => item === null || typeof item !== 'object');

export const keyOf = (item: Item) => String(item.id);

/** Own property only, so keys such as `constructor` never read the prototype */
export const own = (object: Json | undefined, key: string): unknown =>
	object && Object.hasOwn(object, key) ? object[key] : undefined;

/** Define an own property, so a `__proto__` key stays data */
export const put = (object: Json, key: string, value: unknown) => {
	Object.defineProperty(object, key, {
		value,
		enumerable: true,
		writable: true,
		configurable: true
	});
};

export const byKey = (items: Item[] | undefined) =>
	new Map((items ?? []).map((item) => [keyOf(item), item]));

/** Keep the ID's JSON type: a number stays a number */
export const withIdType = (original: unknown, id: number) =>
	typeof original === 'number' ? id : String(id);
