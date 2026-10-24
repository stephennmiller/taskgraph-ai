/**
 * @fileoverview remove_task, remove_subtask and clear_subtasks: their reply
 * data and errors, in the shapes the legacy tools gave. tm-core is faked at
 * the createTmCore boundary; everything else is real.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const tasks = {
	removeTasks: vi.fn(),
	removeSubtasks: vi.fn(),
	clearSubtasks: vi.fn()
};

vi.mock('@tm/core', async (importOriginal) => ({
	...(await importOriginal<typeof import('@tm/core')>()),
	createTmCore: vi.fn(async () => ({ tasks }))
}));

import {
	registerClearSubtasksTool,
	registerRemoveSubtaskTool,
	registerRemoveTaskTool
} from './removal.tool.js';

type Tool = {
	execute: (args: Record<string, unknown>, ctx: unknown) => Promise<any>;
};

function call(registerTool: (server: any) => void, args: object) {
	const registered: Tool[] = [];
	registerTool({ addTool: (tool: Tool) => registered.push(tool) });
	return registered[0].execute({ projectRoot, ...args }, ctx);
}

const ctx = {
	log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
	session: undefined
};
const projectRoot = process.cwd();
const reply = (result: any) => JSON.parse(result.content[0].text);

beforeEach(() => vi.clearAllMocks());

describe('remove_task', () => {
	it('replies with what was removed and a fix-dependencies hint', async () => {
		const removed = [{ id: '5', title: 'Five' }];
		tasks.removeTasks.mockResolvedValue({
			removedTasks: removed,
			messages: ["Successfully removed task 5 from tag 'dev'"],
			danglingDependents: 2,
			errors: [],
			tag: 'dev',
			tasksPath: '/p/tasks.json'
		});

		const result = reply(
			await call(registerRemoveTaskTool, { id: '5', tag: 'dev' })
		);

		expect(tasks.removeTasks).toHaveBeenCalledWith('5', { tag: 'dev' });
		expect(result.tag).toBe('dev');
		expect(result.data).toEqual({
			totalTasks: 1,
			successful: 1,
			failed: 0,
			removedTasks: removed,
			message: "Successfully removed task 5 from tag 'dev'",
			tasksPath: '/p/tasks.json',
			tag: 'dev',
			hint: '2 tasks depend on missing tasks. Run: taskgraph fix-dependencies --tag dev'
		});
	});

	it('replies with the error tm-core threw', async () => {
		tasks.removeTasks.mockRejectedValue(
			new Error("The following tasks were not found in tag 'master': 99")
		);

		const result = await call(registerRemoveTaskTool, { id: '99' });

		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain(
			"Error: The following tasks were not found in tag 'master': 99"
		);
	});
});

describe('remove_subtask', () => {
	it('says what the subtask became, or that it was removed', async () => {
		const task = { id: 7, title: 'Promoted' };
		tasks.removeSubtasks.mockResolvedValueOnce({ converted: [task], tag: 'm' });
		tasks.removeSubtasks.mockResolvedValueOnce({ converted: [null], tag: 'm' });

		const converted = reply(
			await call(registerRemoveSubtaskTool, { id: '2.1', convert: true })
		);
		const removed = reply(await call(registerRemoveSubtaskTool, { id: '2.2' }));

		expect(tasks.removeSubtasks).toHaveBeenCalledWith(['2.1'], {
			tag: undefined,
			convert: true
		});
		expect(converted.data).toEqual({
			message: 'Subtask 2.1 successfully converted to task #7',
			task
		});
		expect(removed.data).toEqual({ message: 'Subtask 2.2 successfully removed' });
	});
});

describe('clear_subtasks', () => {
	it('gives task IDs as numbers, as the legacy tool did', async () => {
		tasks.clearSubtasks.mockResolvedValue({
			cleared: [{ id: '4', title: 'Four', count: 2 }],
			empty: [{ id: '1', title: 'One' }],
			tag: 'master'
		});

		const result = reply(await call(registerClearSubtasksTool, { all: true }));

		expect(tasks.clearSubtasks).toHaveBeenCalledWith('all', {
			tag: undefined
		});
		expect(result.data).toEqual({
			message: "Cleared 2 subtask(s) from 1 task(s) in tag 'master'",
			tasksCleared: [{ id: 4, title: 'Four', subtasksCleared: 2 }],
			tasksWithoutSubtasks: [{ id: 1, title: 'One' }],
			tag: 'master'
		});
	});

	it('fails for all on a tag with no tasks', async () => {
		tasks.clearSubtasks.mockResolvedValue({
			cleared: [],
			empty: [],
			tag: 'empty'
		});

		const result = await call(registerClearSubtasksTool, { all: true });

		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain(
			"No tasks found in tag context 'empty'"
		);
	});
});
