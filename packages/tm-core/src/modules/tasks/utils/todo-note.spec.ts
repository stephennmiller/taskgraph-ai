import { describe, expect, it } from 'vitest';
import { todoListNote } from './todo-note.js';

const input = (todos: unknown) =>
	JSON.stringify({ tool_name: 'TodoWrite', tool_input: { todos } });

describe('todoListNote', () => {
	it('lists the items once every one is completed', () => {
		expect(
			todoListNote(
				input([
					{ content: 'Add the route', status: 'completed', activeForm: 'x' },
					{ content: 'Run  the\ntests', status: 'completed', activeForm: 'y' }
				])
			)
		).toBe("Claude's todo list, all done:\n- Add the route\n- Run the tests");
	});

	it('logs nothing while an item is open, or for input that is not a todo list', () => {
		expect(
			todoListNote(
				input([
					{ content: 'a', status: 'completed' },
					{ content: 'b', status: 'in_progress' }
				])
			)
		).toBeUndefined();
		expect(todoListNote(input([]))).toBeUndefined();
		expect(todoListNote('{"tool_input":{}}')).toBeUndefined();
		expect(todoListNote('not json')).toBeUndefined();
	});

	it('cuts a long list', () => {
		const todos = Array.from({ length: 32 }, (_, i) => ({
			content: `step ${i}`,
			status: 'completed'
		}));
		const lines = todoListNote(input(todos))?.split('\n') ?? [];
		expect(lines).toHaveLength(32);
		expect(lines.at(-1)).toBe('- and 2 more');
	});
});
