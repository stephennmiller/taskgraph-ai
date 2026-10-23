import { createTmCore, readArchivedIdsSync } from '@tm/core';
import { log, readJSON } from '../utils.js';

/**
 * Load a tag's tasks for `list`, through tm-core, falling back to readJSON
 * when tm-core can't load them. Also returns the tag's archived task IDs:
 * dependencies on them count as done when picking the next task.
 * @param {string} tasksPath - Path to the tasks.json file
 * @param {Object} context
 * @param {string} [context.projectRoot] - Project root path
 * @param {string} [context.tag] - Tag to load
 * @returns {Promise<{data: {tasks: Object[]}|null, archivedIds: Set<string>}>}
 */
export async function loadListTasks(tasksPath, { projectRoot, tag } = {}) {
	try {
		const tmCore = await createTmCore({
			projectPath: projectRoot || process.cwd()
		});
		const result = await tmCore.tasks.list({ tag });
		log('debug', `Loaded ${result.tasks.length} tasks via tm-core`);
		return {
			data: { tasks: result.tasks },
			archivedIds: await tmCore.tasks.getArchivedIds(tag)
		};
	} catch (storageError) {
		// A missing tag is an answer, not a storage failure: readJSON would
		// fall back to master and list its tasks under the requested tag
		if (storageError?.code === 'NOT_FOUND') {
			throw storageError;
		}
		log(
			'warn',
			`TmCore failed, falling back to legacy readJSON: ${storageError.message}`
		);
		const data = readJSON(tasksPath, projectRoot, tag);
		return {
			data,
			archivedIds: readArchivedIdsSync(tasksPath, data?.tag || 'master').ids
		};
	}
}
