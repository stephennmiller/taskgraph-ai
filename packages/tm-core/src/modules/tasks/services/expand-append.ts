/**
 * @fileoverview `expand --append`: keep a task's subtasks and add new ones
 * after them, with the existing ones shown to the AI so it doesn't repeat
 * them (#992).
 */

import {
	ERROR_CODES,
	TaskGraphError
} from '../../../common/errors/taskgraph-error.js';
import type { Subtask } from '../../../common/types/index.js';

/** append adds to the subtasks and force replaces them, so not both */
export function refuseAppendWithForce(options: {
	append?: boolean;
	force?: boolean;
}): void {
	if (options.append && options.force) {
		throw new TaskGraphError(
			"append and force can't be used together: append keeps the subtasks, force replaces them",
			ERROR_CODES.VALIDATION_ERROR
		);
	}
}

/** The subtasks a task has, for the prompt under append */
function formatExistingSubtasks(taskId: string, subtasks: Subtask[]): string {
	const lines = subtasks.map((s) => {
		const id = `${taskId}.${String(s.id).split('.').pop()}`;
		const description = s.description ? `: ${s.description}` : '';
		return `- ${id} (${s.status || 'pending'}) ${s.title}${description}`;
	});
	return `## Existing subtasks\n\n${lines.join('\n')}`;
}

/**
 * The prompt's additionalContext and gatheredContext: with subtasks to
 * append to, the context lists them (inside its task-data fence) and the
 * additional context says not to repeat them
 */
export function appendPromptContext(
	taskId: string,
	existing: Subtask[],
	prompt: string | undefined,
	gatheredContext: string
): { additionalContext: string; gatheredContext: string } {
	if (existing.length === 0) {
		return { additionalContext: prompt || '', gatheredContext };
	}
	const note = `Task ${taskId} already has the subtasks listed under "Existing subtasks" in the project context. Keep them: don't repeat or rewrite them, and write only new subtasks for the work they don't cover.`;
	return {
		additionalContext: prompt ? `${prompt}\n\n${note}` : note,
		gatheredContext:
			`${gatheredContext}\n\n${formatExistingSubtasks(taskId, existing)}`.trim()
	};
}
