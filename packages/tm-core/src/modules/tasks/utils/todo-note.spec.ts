import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
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

describe('todoListNote with the task tools (#1074)', () => {
	const dirs: string[] = [];
	afterAll(() => {
		for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
	});
	/** A session's calls, as Claude Code's PostToolUse hook input */
	const session = () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-todo-list-'));
		dirs.push(dir);
		let next = 0;
		const call = (fields: object) =>
			todoListNote(JSON.stringify({ session_id: 's-1', ...fields }), dir);
		return {
			dir,
			create: (subject: string) =>
				call({
					tool_name: 'TaskCreate',
					tool_input: { subject, description: 'd' },
					tool_response: { task: { id: String(++next), subject } }
				}),
			update: (taskId: string, input: object) =>
				call({
					tool_name: 'TaskUpdate',
					tool_input: { taskId, ...input },
					tool_response: { success: true, taskId, updatedFields: [] }
				})
		};
	};

	it('lists the tasks once the last one is completed', () => {
		const s = session();
		expect(s.create('Add the route')).toBeUndefined();
		s.create('Run the tests');
		expect(s.update('1', { status: 'completed' })).toBeUndefined();
		expect(s.update('2', { status: 'in_progress' })).toBeUndefined();

		expect(s.update('2', { status: 'completed' })).toBe(
			"Claude's todo list, all done:\n- Add the route\n- Run the tests"
		);
		expect(fs.statSync(path.join(s.dir, 'todos-s-1')).mode & 0o777).toBe(0o600);
	});

	it('follows renames and deletions', () => {
		const s = session();
		s.create('a');
		s.create('b');
		s.update('1', { subject: 'A', status: 'completed' });

		expect(s.update('2', { status: 'deleted' })).toBe(
			"Claude's todo list, all done:\n- A"
		);
	});

	it('starts a new list with the first task added after one is finished', () => {
		const s = session();
		s.create('a');
		s.update('1', { status: 'completed' });
		s.create('b');

		expect(s.update('2', { status: 'completed' })).toBe(
			"Claude's todo list, all done:\n- b"
		);
	});

	it('logs nothing without the folder, a session ID or a successful update', () => {
		const s = session();
		s.create('a');
		const done = {
			session_id: 's-1',
			tool_name: 'TaskUpdate',
			tool_input: { taskId: '1', status: 'completed' }
		};

		expect(todoListNote(JSON.stringify(done))).toBeUndefined();
		expect(
			todoListNote(JSON.stringify({ ...done, session_id: '../x' }), s.dir)
		).toBeUndefined();
		expect(
			todoListNote(
				JSON.stringify({ ...done, tool_response: { success: false } }),
				s.dir
			)
		).toBeUndefined();
		expect(fs.readdirSync(s.dir)).toEqual(['todos-s-1']);
	});
});
