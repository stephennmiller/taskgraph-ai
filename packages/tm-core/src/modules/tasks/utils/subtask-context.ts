/**
 * @fileoverview A subtask read on its own, with what it takes from its parent
 */

import type { Subtask, Task } from '../../../common/types/index.js';
import { fullSubtaskId } from '../validation/task-id.js';

/**
 * A subtask with its full dotted ID (`3.2`), its parent's ID, the parent's priority when it has none of
 * its own, and a title and status when it has none, so `show 3.2` and
 * `next` describe it the same way.
 * Stored subtasks carry neither. Read only; never save the result.
 */
export function subtaskInContext(parent: Task, subtask: Subtask): Subtask {
	return {
		...subtask,
		id: fullSubtaskId(parent.id, subtask.id),
		title: subtask.title || `Subtask ${subtask.id}`,
		status: subtask.status || 'pending',
		parentId: String(parent.id),
		priority: subtask.priority || parent.priority || 'medium'
	};
}
