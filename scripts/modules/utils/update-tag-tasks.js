/**
 * @fileoverview Change one tag of a tasks file under the file lock
 */
import { normalizeTaskStatuses } from '@tm/core';
import { modifyJSON } from '../utils.js';
import { getOwnTag, setOwnTag } from './own-tag.js';

/**
 * Change one tag of a tasks file under the file lock. The file is read inside
 * the lock, so changes other processes made since the caller read it (for
 * example while an AI call was running) are kept. `mutate` changes the tag
 * object in place.
 *
 * @param {string} filepath - Path to the tasks file
 * @param {string} tag - Tag to change; it must exist
 * @param {Function} mutate - (tagData: {tasks: Array, metadata: Object}) => any
 * @param {Object} [options]
 * @param {Object} [options.createWith] - Tag object to start from when the file
 *   is missing or empty. A file that has other tags but not this one still throws.
 * @returns {Promise<any>} Whatever `mutate` returned
 */
export async function updateTagTasks(filepath, tag, mutate, options = {}) {
	let result;
	await modifyJSON(filepath, (current) => {
		const data = current ?? {};
		if (
			!getOwnTag(data, tag) &&
			options.createWith &&
			Object.keys(data).length === 0
		) {
			setOwnTag(data, tag, options.createWith);
		}
		const tagData = getOwnTag(data, tag);
		if (!tagData || !Array.isArray(tagData.tasks)) {
			throw new Error(`Tag "${tag}" no longer exists in ${filepath}`);
		}
		result = mutate(tagData);
		// Write the older 'completed' status as 'done', as every other save does
		if (Array.isArray(tagData.tasks)) {
			tagData.tasks = normalizeTaskStatuses(tagData.tasks);
		}
		return data;
	});
	return result;
}
