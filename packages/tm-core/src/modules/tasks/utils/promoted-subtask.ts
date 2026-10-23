/**
 * @fileoverview The description a task takes when it has none.
 */

/**
 * A subtask can have no description (`add-subtask` without `--description`).
 * When a subtask becomes a task (`remove-subtask --convert`, `move --from=1.2
 * --to=9`), an empty description falls back to the title. Loading a task
 * applies the same rule in memory (TaskEntity, TaskService.getTask), so a
 * `tasks.json` an earlier version wrote with an empty description still loads.
 *
 * @param subtask - The subtask being turned into a task, or a loaded task
 * @returns Its description, or its title when the description is empty or not
 * a string (hand-edited `tasks.json`)
 */
export function promotedSubtaskDescription(subtask: {
	title?: string | null;
	description?: unknown;
}): string {
	const { description } = subtask;
	return typeof description === 'string' && description.trim()
		? description
		: (subtask.title ?? '');
}
