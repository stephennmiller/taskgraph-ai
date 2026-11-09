/**
 * @fileoverview The note the plugin logs from Claude Code's own todo list
 * (#953, #1074). Its PostToolUse hook hands over each TodoWrite, TaskCreate
 * and TaskUpdate call; once every item is completed, the list becomes one
 * note on the task in progress, so the steps Claude took are kept without
 * turning micro-steps into subtasks.
 */

import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Items a note lists; a longer list is cut */
const MAX_ITEMS = 30;
/** Characters per item */
const MAX_ITEM = 200;

interface TodoItem {
	text: unknown;
	status: unknown;
}

/**
 * The note for a hook input, or undefined while any item is still open (or
 * the input isn't a call that finishes a list).
 *
 * TodoWrite sends the whole list. TaskCreate and TaskUpdate send one task
 * each, so their calls are kept per session, in `todos-<session_id>` in
 * `listDir` (the plugin's private folder); without it they log nothing.
 */
export function todoListNote(
	hookInput: string,
	listDir?: string
): string | undefined {
	let input: any;
	try {
		input = JSON.parse(hookInput);
	} catch {
		return undefined;
	}
	const todos = input?.tool_input?.todos;
	if (Array.isArray(todos)) {
		return listNote(
			todos.map((todo) => ({ text: todo?.content, status: todo?.status }))
		);
	}
	const tasks = listDir ? trackTaskList(input, listDir) : undefined;
	return tasks && listNote(tasks);
}

function listNote(todos: TodoItem[]): string | undefined {
	if (todos.length === 0) return undefined;
	const items: string[] = [];
	for (const todo of todos) {
		if (todo.status !== 'completed' || typeof todo.text !== 'string') {
			return undefined;
		}
		const text = todo.text.replace(/\s+/g, ' ').trim();
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

/** One TaskCreate (`created`) or TaskUpdate call, as kept in the list file */
interface TaskEvent {
	id: string;
	created?: true;
	subject?: unknown;
	status?: unknown;
}

/**
 * Record a TaskCreate or TaskUpdate call (shapes: Claude Code's
 * TaskCreateOutput `{ task: { id } }` and TaskUpdateInput `{ taskId, status,
 * subject }`), and after a TaskUpdate, the only call that can finish the
 * list, return the session's list. Calls are appended one JSON line each
 * and replayed, so hooks for parallel calls can't overwrite each other's.
 */
function trackTaskList(input: any, listDir: string): TodoItem[] | undefined {
	const sessionId = input.session_id;
	if (typeof sessionId !== 'string' || !/^[\w-]+$/.test(sessionId)) {
		return undefined;
	}
	const { tool_name: tool, tool_input: args, tool_response: result } = input;
	let event: TaskEvent;
	if (tool === 'TaskCreate') {
		event = { id: result?.task?.id, created: true, subject: args?.subject };
	} else if (tool === 'TaskUpdate' && result?.success !== false) {
		event = {
			id: result?.taskId ?? args?.taskId,
			subject: args?.subject,
			status: args?.status
		};
	} else {
		return undefined;
	}
	if (typeof event.id !== 'string' || !event.id) return undefined;

	const file = join(listDir, `todos-${sessionId}`);
	// shortcut: the file grows with each call and is replayed whole; fine for one session's list
	appendFileSync(file, `${JSON.stringify(event)}\n`, { mode: 0o600 });
	if (tool !== 'TaskUpdate') return undefined;

	// Keyed by Claude's task IDs, so a Map
	const tasks = new Map<string, TodoItem>();
	const allDone = () =>
		[...tasks.values()].every((task) => task.status === 'completed');
	for (const line of readFileSync(file, 'utf8').split('\n')) {
		let e: TaskEvent;
		try {
			e = JSON.parse(line);
		} catch {
			continue;
		}
		if (e.created) {
			// A task added once the list is finished starts a new list
			if (tasks.size > 0 && allDone()) tasks.clear();
			tasks.set(e.id, { text: e.subject, status: 'pending' });
			continue;
		}
		const task = tasks.get(e.id);
		if (!task) continue;
		if (e.status === 'deleted') {
			tasks.delete(e.id);
			continue;
		}
		if (typeof e.status === 'string') task.status = e.status;
		if (typeof e.subject === 'string') task.text = e.subject;
	}
	return [...tasks.values()];
}
