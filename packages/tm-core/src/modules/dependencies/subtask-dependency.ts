/**
 * @fileoverview The one rule for what a subtask's dependency names.
 *
 * - a number up to 99 (`3`) is a sibling subtask: `<parent>.3`
 * - a dotted string (`"2.1"`) is that subtask
 * - anything else (`"3"`, or a number of 100 or more) is a task
 *
 * The JSON type carries the meaning: `add-dependency` and `add-subtask` write
 * `"3"` for a task, and the AI writes a bare number for a sibling and a string
 * for a task or another task's subtask. The cutoff of 99 is
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

/** A task ID (`3`) or a subtask ID (`3.2`), as a user or the AI writes it */
const DEPENDENCY_ID = /^[1-9]\d*(\.[1-9]\d*)?$/;

/**
 * Parse the dependency list a user typed for a new subtask
 * (`add-subtask --dependencies=3,5.2`). Each ID means what it means in
 * `add-dependency`: `3` is task 3 and `5.2` is that subtask. The IDs are
 * stored as strings, the form `resolveSubtaskDependency` reads as a task.
 * @param input - Comma-separated IDs
 * @throws Error naming the first entry that is not a task or subtask ID
 */
export function parseSubtaskDependencyInput(input: string): string[] {
	const ids: string[] = [];
	for (const entry of input.split(',')) {
		const id = entry.trim();
		if (id === '') continue;
		if (!DEPENDENCY_ID.test(id)) {
			throw new Error(
				`"${id}" is not a task or subtask ID. Use IDs like 3 or 5.2`
			);
		}
		if (!ids.includes(id)) ids.push(id);
	}
	return ids;
}

/**
 * Keep the dependencies the AI wrote for a generated subtask that name
 * something, in the forms `resolveSubtaskDependency` reads:
 * - a number up to 99 is a sibling. With `subtaskId`, it is kept only when it
 *   names an earlier sibling (the AI renumbers, so a later one may not exist)
 * - a larger number, `"3"` or `"3.2"` is a task or subtask and is kept as is
 * Anything else, a dependency on the parent task itself, and repeats of the
 * same item are dropped.
 * @param dependencies - What the AI returned
 * @param parentId - ID of the task that holds the subtask
 * @param subtaskId - The subtask's own ID, when siblings must come before it
 */
export function cleanGeneratedSubtaskDependencies(
	dependencies: unknown,
	parentId: string | number,
	subtaskId?: number
): Array<string | number> {
	if (!Array.isArray(dependencies)) return [];
	const kept: Array<string | number> = [];
	const seen = new Set<string>();
	for (const raw of dependencies) {
		let dependency: string | number;
		if (typeof raw === 'number') {
			if (!Number.isInteger(raw) || raw < 1) continue;
			if (
				isSiblingReference(raw) &&
				subtaskId !== undefined &&
				raw >= subtaskId
			) {
				continue;
			}
			dependency = raw;
		} else if (typeof raw === 'string' && DEPENDENCY_ID.test(raw.trim())) {
			dependency = raw.trim();
		} else {
			continue;
		}
		const full = resolveSubtaskDependency(parentId, dependency);
		if (full === String(parentId) || seen.has(full)) continue;
		seen.add(full);
		kept.push(dependency);
	}
	return kept;
}
