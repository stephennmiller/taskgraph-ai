/**
 * @fileoverview Merge an AI rewrite of a task or subtask onto the stored one.
 */

/**
 * Copy every field of the stored task or subtask that a rewrite leaves out.
 * AI rewrites (`update-task`, `update`) return only the fields their schema
 * has; without this a rewrite drops everything else the task holds, such as
 * its GitHub link, tags, assignee, acceptance criteria and checked Definition
 * of Done items. Fields the rewrite sets, even to null, are kept as sent.
 *
 * @param target - The rewritten task or subtask, changed in place
 * @param source - The task or subtask as stored, if there was one
 * @returns The target
 */
export function keepStoredFields<T extends object>(
	target: T,
	source: object | undefined
): T {
	if (!source) return target;
	const fields = target as Record<string, unknown>;
	for (const [key, value] of Object.entries(source)) {
		if (fields[key] === undefined) fields[key] = value;
	}
	return target;
}
