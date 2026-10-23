/**
 * @fileoverview Key access on parsed JSON that ignores the object prototype.
 * Tag names and task keys come from users: `constructor` or `toString` must
 * not read an inherited member, and `__proto__` must stay a plain key.
 */

/** Own property only, so keys such as `constructor` never read the prototype */
export const own = <T>(
	object: Record<string, T>,
	key: string
): T | undefined => (Object.hasOwn(object, key) ? object[key] : undefined);

/** Define an own property, so a `__proto__` key stays data */
export const put = (
	object: Record<string, unknown>,
	key: string,
	value: unknown
): void => {
	Object.defineProperty(object, key, {
		value,
		enumerable: true,
		writable: true,
		configurable: true
	});
};
