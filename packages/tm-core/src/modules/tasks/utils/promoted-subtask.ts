/**
 * @fileoverview The description a subtask takes when it becomes a task.
 */

/**
 * A task needs a description to load, but a subtask can have none (`add-subtask`
 * without `--description`). When a subtask becomes a task (`remove-subtask
 * --convert`, `move --from=1.2 --to=9`), an empty description falls back to
 * the title, so the new task loads.
 *
 * @param subtask - The subtask being turned into a task
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
