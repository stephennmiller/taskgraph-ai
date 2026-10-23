/**
 * @fileoverview Three-way merge of archive.json for the Git merge driver
 */

import { archiveTag, archivedTasksById } from '../../tasks/utils/archive.js';
import { type TasksMergeResult, mergeTasksJson } from './merge-tasks-json.js';

/**
 * Merge three versions of archive.json: tags and tasks as in tasks.json, but
 * no task is renumbered, since tasks.json may depend on an archived ID.
 *
 * @param options.tasks - This branch's tasks.json. A task the incoming branch
 *   archived under an ID this branch gave a different task (another title) is
 *   reported as an `archived-theirs` conflict: moving this branch's task
 *   means rewriting tasks.json, which this merge can't do.
 */
export function mergeArchiveJson(
	base: unknown,
	ours: unknown,
	theirs: unknown,
	options: { tasks?: unknown } = {}
): TasksMergeResult {
	const result = mergeTasksJson(base, ours, theirs, { renumber: false });
	const tags = theirs && typeof theirs === 'object' ? Object.keys(theirs) : [];
	for (const tag of tags) {
		const before = archivedTasksById(base, tag).tasks;
		// tasks.json has the archive's shape: { <tag>: { tasks } }
		const live = new Map(
			archiveTag(options.tasks, tag).tasks.map((t) => [String(t.id), t])
		);
		for (const [id, archived] of archivedTasksById(theirs, tag).tasks) {
			const here = live.get(id);
			if (before.has(id) || !here || here.title === archived.title) continue;
			result.conflicts.push({
				tag,
				id,
				field: '',
				kind: 'archived-theirs',
				ours: here,
				theirs: archived
			});
		}
	}
	return result;
}
