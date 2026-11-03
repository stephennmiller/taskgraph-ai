/**
 * @fileoverview The note the plugin logs from Claude Code's own todo list
 * (#953). Its PostToolUse hook hands over the TodoWrite call; once every
 * item is completed, the list becomes one note on the task in progress, so
 * the steps Claude took are kept without turning micro-steps into subtasks.
 */

/** Items a note lists; a longer list is cut */
const MAX_ITEMS = 30;
/** Characters per item */
const MAX_ITEM = 200;

/**
 * The note for a TodoWrite hook input, or undefined while any item is still
 * open (or the input isn't a TodoWrite call with items)
 */
export function todoListNote(hookInput: string): string | undefined {
	let todos: unknown;
	try {
		todos = JSON.parse(hookInput)?.tool_input?.todos;
	} catch {
		return undefined;
	}
	if (!Array.isArray(todos) || todos.length === 0) return undefined;
	const items: string[] = [];
	for (const todo of todos) {
		if (todo?.status !== 'completed' || typeof todo.content !== 'string') {
			return undefined;
		}
		const text = todo.content.replace(/\s+/g, ' ').trim();
		if (text) items.push(`- ${text.slice(0, MAX_ITEM)}`);
	}
	if (items.length === 0) return undefined;
	const more = items.length - MAX_ITEMS;
	return [
		"Claude's todo list, all done:",
		...items.slice(0, MAX_ITEMS),
		...(more > 0 ? [`- and ${more} more`] : [])
	].join('\n');
}
