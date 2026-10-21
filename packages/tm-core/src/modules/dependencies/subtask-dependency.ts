/**
 * @fileoverview The one rule for what a subtask's dependency names.
 *
 * - a number up to 99 (`3`) is a sibling subtask: `<parent>.3`
 * - a dotted string (`"2.1"`) is that subtask
 * - anything else (`"3"`, or a number of 100 or more) is a task
 *
 * The JSON type carries the meaning: `add-dependency` writes `"3"` for a
 * task, and the AI paths write bare numbers for siblings. The cutoff of 99 is
 * the one the legacy validate, fix, list and remove code applied. Without it,
 * `fix-dependencies` would delete a legitimate dependency on task 150 stored
 * as a number, as old projects with 100+ tasks have. The cost is that a
 * sibling numbered 100 or more must be written dotted; no parent
 * has that many subtasks in practice. Anything that reads a subtask's
 * dependencies goes through here so the CLI, MCP and the legacy scripts agree.
 */

/** Highest bare number read as a sibling subtask */
export const MAX_SIBLING_REFERENCE = 99;

/** Whether a stored dependency is a bare number naming a sibling subtask */
export function isSiblingReference(
	dependency: string | number
): dependency is number {
	return typeof dependency === 'number' && dependency <= MAX_SIBLING_REFERENCE;
}

/**
 * Resolve a dependency listed on a subtask to a full task or subtask ID.
 * @param parentId - ID of the task that holds the subtask
 * @param dependency - The dependency as stored in the subtask
 */
export function resolveSubtaskDependency(
	parentId: string | number,
	dependency: string | number
): string {
	return isSiblingReference(dependency)
		? `${parentId}.${dependency}`
		: String(dependency);
}
