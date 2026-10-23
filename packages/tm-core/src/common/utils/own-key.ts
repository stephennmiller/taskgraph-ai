/**
 * @fileoverview Key access on parsed JSON that ignores the object prototype.
 * Tag names and task keys come from users: `constructor` or `toString` must
 * not read an inherited member, and `__proto__` must stay a plain key.
 */

/**
 * The object's own value for `key`, so keys such as `constructor` never read
 * the prototype. Undefined for a missing key or a non-object.
 */
export function getOwnKey<T = any>(
	object: Readonly<Record<string, T>> | null | undefined,
	key: string
): T | undefined {
	return object !== null &&
		typeof object === 'object' &&
		Object.hasOwn(object, key)
		? object[key]
		: undefined;
}

/** Define an own property, so a `__proto__` key stays data */
export function setOwnKey(
	object: Record<string, unknown>,
	key: string,
	value: unknown
): void {
	Object.defineProperty(object, key, {
		value,
		enumerable: true,
		writable: true,
		configurable: true
	});
}
