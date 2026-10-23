/**
 * @fileoverview Tag lookups on tagged tasks.json data that ignore the object
 * prototype. A tag named `constructor` or `toString` must not read an
 * inherited member, and a tag named `__proto__` must stay a plain key.
 */

/**
 * A tag's entry in tagged tasks.json data. Only the data's own keys count, so
 * a tag named `constructor` or `toString` isn't read off the object prototype.
 * @param {Object} data - The parsed tasks.json data
 * @param {string} tagName - The tag name
 * @returns {Object|undefined} The tag's entry, or undefined when there's none
 */
export function getOwnTag(data, tagName) {
	return data && typeof data === 'object' && Object.hasOwn(data, tagName)
		? data[tagName]
		: undefined;
}

/**
 * Set a tag's entry as an own key, so a tag named `__proto__` stays data
 * instead of replacing the object's prototype
 * @param {Object} data - The tasks.json data object
 * @param {string} tagName - The tag name
 * @param {Object} value - The tag's entry
 */
export function setOwnTag(data, tagName, value) {
	Object.defineProperty(data, tagName, {
		value,
		enumerable: true,
		writable: true,
		configurable: true
	});
}
