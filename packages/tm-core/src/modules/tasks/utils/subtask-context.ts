/**
 * @fileoverview A subtask read on its own, with what it takes from its parent
 */

import type { Subtask, Task } from '../../../common/types/index.js';

/**
 * A subtask with its parent's ID, and the parent's priority when it has
 * none of its own, so `show 3.2` and `next` describe it the same way.
 * Stored subtasks carry neither. Read only; never save the result.
 */
export function subtaskInContext(parent: Task, subtask: Subtask): Subtask {
	return {
		...subtask,
		parentId: String(parent.id),
		priority: subtask.priority || parent.priority || 'medium'
	};
}
