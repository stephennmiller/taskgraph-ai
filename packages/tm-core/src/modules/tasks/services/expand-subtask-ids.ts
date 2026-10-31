/**
 * @fileoverview The IDs expand gives the subtasks it adds, at save time.
 */

import type { Subtask } from '../../../common/types/index.js';
import {
	assignMetadata,
	reconcileDependencySources
} from '../../dependencies/dependency-provenance.js';
import {
	isSiblingReference,
	resolveSubtaskDependency
} from '../../dependencies/subtask-dependency.js';

/**
 * Number the new subtasks on from the highest ID the task has now, and point
 * their dependencies on each other at the new IDs. The AI call ran without
 * the lock, so another writer may have added a subtask meanwhile (#569).
 */
export function renumberSubtasks(
	taskId: string,
	existing: Subtask[],
	added: Subtask[]
): void {
	// A subtask may be stored as "3.2" rather than 2
	const highest = Math.max(
		0,
		...existing.map((s) => Number(String(s.id).split('.').pop()) || 0)
	);
	// A repeated AI ID gets its own new ID; a reference to it means the first
	const newIds = new Map<string, number>();
	added.forEach((s, i) => {
		if (!newIds.has(String(s.id))) newIds.set(String(s.id), highest + i + 1);
	});
	added.forEach((subtask, i) => {
		subtask.id = String(highest + i + 1);
		subtask.dependencies = (subtask.dependencies ?? []).map((raw) => {
			const dep = resolveSubtaskDependency(taskId, raw);
			const newId = dep.startsWith(`${taskId}.`)
				? newIds.get(dep.slice(taskId.length + 1))
				: undefined;
			if (newId === undefined) return raw;
			return typeof raw === 'number' && isSiblingReference(newId)
				? newId
				: `${taskId}.${newId}`;
		});
		// The inferred marks are keyed by dependency ID
		assignMetadata(
			subtask,
			reconcileDependencySources(subtask, undefined, taskId)
		);
	});
}
