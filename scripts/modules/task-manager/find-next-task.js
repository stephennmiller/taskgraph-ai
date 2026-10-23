import {
	satisfyArchivedDependencies,
	selectNextTask,
	withStoredDependencies
} from '@tm/core';
import { addComplexityToTask } from '../utils.js';

/**
 * Return the next work item:
 *   •  Prefer an eligible SUBTASK that belongs to any parent task
 *      whose own status is `in-progress`.
 *   •  If no such subtask exists, fall back to the best top-level task
 *      (previous behaviour).
 *   •  Ties break by priority, then how much work a task unblocks, then
 *      fewest dependencies, then lowest id. The rule is in @tm/core.
 *
 * The function still exports the same name (`findNextTask`) so callers
 * don't need to change.  It now always returns an object with
 *  ─ id            →  number  (task)  or  "parentId.subId"  (subtask)
 *  ─ title         →  string
 *  ─ status        →  string
 *  ─ priority      →  string  ("critical" | "high" | "medium" | "low")
 *  ─ dependencies  →  array   (all IDs expressed in the same dotted form)
 *  ─ parentId      →  number  (present only when it's a subtask)
 *
 * @param {Object[]} tasks  – full array of top-level tasks, each may contain .subtasks[]
 * @param {Object} [complexityReport=null] - Optional complexity report object
 * @param {Set<string>} [archivedIds] - Archived task IDs; dependencies on
 *   them count as done
 * @returns {Object|null}   – next work item or null if nothing is eligible
 */
function findNextTask(tasks, complexityReport = null, archivedIds = new Set()) {
	// The rule lives in @tm/core so the CLI, MCP and list view agree
	const picked = selectNextTask(
		satisfyArchivedDependencies(tasks, archivedIds)
	);
	if (!picked) return null;

	let nextTask;
	if (picked.parentId !== undefined) {
		nextTask = {
			id: picked.id,
			title: picked.title,
			status: picked.status,
			priority: picked.priority,
			// What it really depends on, archived tasks included
			dependencies: withStoredDependencies(picked, tasks).dependencies,
			parentId: Number(picked.parentId)
		};
	} else {
		nextTask = tasks.find((t) => String(t.id) === String(picked.id));
	}

	if (complexityReport) {
		addComplexityToTask(nextTask, complexityReport);
	}
	return nextTask;
}

export default findNextTask;
