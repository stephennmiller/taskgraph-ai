/**
 * @fileoverview remove-task, remove-subtask and clear-subtasks: what they
 * print, when they ask first, and their exit codes. tm-core is faked at
 * createTmCore; Commander and chalk are real.
 */

import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tm/core', async (importOriginal) => ({
	...(await importOriginal<typeof import('@tm/core')>()),
	createTmCore: vi.fn()
}));

import { TASKGRAPH_TASKS_FILE, createTmCore } from '@tm/core';
import {
	ClearSubtasksCommand,
	RemoveSubtaskCommand,
	RemoveTaskCommand
} from './removal.command.js';

const tasks = {
	previewTaskRemoval: vi.fn(),
	removeTasks: vi.fn(),
	removeSubtasks: vi.fn(),
	clearSubtasks: vi.fn()
};

function run(...args: string[]): Promise<unknown> {
	const program = new Command().exitOverride();
	for (const command of [
		RemoveTaskCommand,
		RemoveSubtaskCommand,
		ClearSubtasksCommand
	]) {
		command.register(program);
	}
	return program.parseAsync([...args, '-p', process.cwd()], { from: 'user' });
}

const output = (stream: 'log' | 'error' | 'warn') =>
	vi
		.mocked(console[stream])
		.mock.calls.map((call) => call.join(' '))
		.join('\n');

const preview = (found: string[], missing: string[] = []) => ({
	found: found.map((id) => ({ id, title: `Task ${id}` })),
	missing,
	subtaskCount: 0,
	dependents: [],
	tag: 'master'
});

beforeEach(() => {
	vi.clearAllMocks();
	process.exitCode = undefined;
	for (const stream of ['log', 'error', 'warn'] as const) {
		vi.spyOn(console, stream).mockImplementation(() => {});
	}
	vi.mocked(createTmCore).mockResolvedValue({
		tasks,
		projectPath: process.cwd(),
		config: { getActiveTag: () => 'master' },
		close: vi.fn()
	} as any);
	tasks.removeTasks.mockResolvedValue({
		removedTasks: [],
		messages: [],
		danglingDependents: 0,
		errors: [],
		tag: 'master',
		tasksPath: ''
	});
});

afterEach(() => {
	process.exitCode = undefined;
	vi.restoreAllMocks();
});

describe('remove-task', () => {
	it('removes every ID with --yes', async () => {
		tasks.previewTaskRemoval.mockResolvedValue(preview(['2', '5.1']));

		await run('remove-task', '--id=2,5.1', '--yes', '--tag=dev');

		expect(tasks.previewTaskRemoval).toHaveBeenCalledWith('2,5.1', {
			tag: 'dev'
		});
		expect(tasks.removeTasks).toHaveBeenCalledWith('2,5.1', { tag: 'dev' });
		expect(output('log')).toContain('Removed 2 tasks: 2, 5.1');
		expect(process.exitCode).toBeUndefined();
	});

	it('exits 1 and removes nothing when one ID of several is unknown', async () => {
		tasks.previewTaskRemoval.mockResolvedValue(preview(['2', '5.1'], ['9']));

		await run('remove-task', '--id=2,9,5.1', '--yes');

		expect(tasks.removeTasks).not.toHaveBeenCalled();
		expect(output('error')).toContain('Task 9 not found; nothing was removed');
		expect(process.exitCode).toBe(1);
	});

	it('exits 1 and removes nothing when no ID exists', async () => {
		tasks.previewTaskRemoval.mockResolvedValue(preview([], ['9']));

		await run('remove-task', '--id=9', '--yes');

		expect(tasks.removeTasks).not.toHaveBeenCalled();
		expect(output('error')).toContain('Task 9 not found');
		expect(process.exitCode).toBe(1);
	});

	it('without a terminal, needs --yes instead of asking', async () => {
		tasks.previewTaskRemoval.mockResolvedValue(preview(['2']));
		const isTTY = process.stdin.isTTY;
		process.stdin.isTTY = false as never;
		try {
			await run('remove-task', '--id=2');
		} finally {
			process.stdin.isTTY = isTTY;
		}

		expect(tasks.removeTasks).not.toHaveBeenCalled();
		expect(output('error')).toContain('--yes');
		expect(process.exitCode).toBe(1);
	});

	it('exits 1 when a task file could not be deleted', async () => {
		tasks.previewTaskRemoval.mockResolvedValue(preview(['2']));
		tasks.removeTasks.mockResolvedValue({
			removedTasks: [{}],
			messages: [],
			danglingDependents: 0,
			errors: ['Failed to delete task file task_002.txt: EACCES'],
			tag: 'master',
			tasksPath: ''
		});

		await run('remove-task', '--id=2', '--yes');

		expect(output('error')).toContain('Removed 1 of 1');
		expect(output('error')).toContain('EACCES');
		expect(process.exitCode).toBe(1);
	});
});

describe('remove-task with a subtask (#882)', () => {
	it('takes IDs as an argument', async () => {
		tasks.previewTaskRemoval.mockResolvedValue(preview(['5', '6']));

		await run('remove-task', '5,6', '--yes');

		expect(tasks.previewTaskRemoval).toHaveBeenCalledWith('5,6', {
			tag: undefined
		});
	});

	it('--convert makes subtasks tasks, as remove-subtask did', async () => {
		tasks.removeSubtasks.mockResolvedValue({
			converted: [{ id: 7, title: 'Promoted' }],
			tag: 'master'
		});

		await run('remove-task', '2.1', '--convert');

		expect(tasks.removeSubtasks).toHaveBeenCalledWith(['2.1'], {
			tag: undefined,
			convert: true
		});
		expect(tasks.removeTasks).not.toHaveBeenCalled();
		expect(output('log')).toContain('Subtask 2.1 is now task 7');
	});

	it('--convert refuses a task ID before changing anything', async () => {
		vi.spyOn(process, 'exit').mockImplementation(() => {
			throw new Error('exit');
		});

		await expect(run('remove-task', '2', '--convert')).rejects.toThrow('exit');

		expect(output('error')).toContain('Only subtasks');
		expect(tasks.removeSubtasks).not.toHaveBeenCalled();
	});
});

describe('remove-task argument checks (#882)', () => {
	beforeEach(() => {
		vi.spyOn(process, 'exit').mockImplementation(() => {
			throw new Error('exit');
		});
	});

	it('--convert refuses a list with a task ID in it, changing nothing', async () => {
		await expect(run('remove-task', '2.1,6', '--convert')).rejects.toThrow(
			'exit'
		);

		expect(output('error')).toContain('"6" isn\'t a subtask ID');
		expect(tasks.removeSubtasks).not.toHaveBeenCalled();
	});

	it('refuses IDs given both as the argument and --id', async () => {
		await expect(run('remove-task', '5', '--id=6', '--yes')).rejects.toThrow(
			'exit'
		);

		expect(output('error')).toContain('not both');
		expect(tasks.previewTaskRemoval).not.toHaveBeenCalled();
		expect(tasks.removeTasks).not.toHaveBeenCalled();
	});
});

describe('remove-subtask', () => {
	it('removes each subtask and says which became a task', async () => {
		tasks.removeSubtasks.mockResolvedValue({
			converted: [null, { id: 7, title: 'Promoted' }],
			tag: 'master'
		});

		await run('remove-subtask', '--id=2.1, 2.2', '--convert');

		expect(tasks.removeSubtasks).toHaveBeenCalledWith(['2.1', '2.2'], {
			tag: undefined,
			convert: true
		});
		expect(output('log')).toContain('Removed subtask 2.1');
		expect(output('log')).toContain('Subtask 2.2 is now task 7');
	});

	it("still takes the old --generate, and -f naming the project's file", async () => {
		tasks.removeSubtasks.mockResolvedValue({
			converted: [null],
			tag: 'master'
		});

		await run(
			'remove-subtask',
			'--id=2.1',
			'--generate',
			'-f',
			TASKGRAPH_TASKS_FILE
		);

		expect(tasks.removeSubtasks).toHaveBeenCalled();
		expect(process.exitCode).toBeUndefined();
	});

	it('refuses -f naming another file, before changing anything', async () => {
		vi.spyOn(process, 'exit').mockImplementation(() => {
			throw new Error('exit');
		});

		await expect(
			run('remove-subtask', '--id=2.1', '-f', 'other/tasks.json')
		).rejects.toThrow('exit');

		expect(output('error')).toContain('--file is no longer supported');
		expect(tasks.removeSubtasks).not.toHaveBeenCalled();
	});

	it('exits 1 when tm-core refuses an ID', async () => {
		tasks.removeSubtasks.mockRejectedValue(new Error('Subtask 2.9 not found'));

		await run('remove-subtask', '--id=2.9');

		expect(output('error')).toContain('Subtask 2.9 not found');
		expect(process.exitCode).toBe(1);
	});
});

describe('clear-subtasks', () => {
	it('clears all tasks with --all', async () => {
		tasks.clearSubtasks.mockResolvedValue({
			cleared: [{ id: '2', title: 'Two', count: 3 }],
			empty: [],
			tag: 'master'
		});

		await run('clear-subtasks', '--all');

		expect(tasks.clearSubtasks).toHaveBeenCalledWith('all', {
			tag: undefined
		});
		expect(output('log')).toContain('Cleared 3 subtasks from task 2');
	});

	it('says nothing was cleared, with the hint tm-core gives', async () => {
		tasks.clearSubtasks.mockRejectedValue(
			Object.assign(new Error('4.1 is a subtask, not a task'), {
				hint: 'Use `taskgraph remove-task 4.1` for one subtask'
			})
		);

		await run('clear-subtasks', '--id=4.1');

		expect(output('error')).toContain(
			'4.1 is a subtask, not a task; nothing was cleared'
		);
		expect(output('error')).toContain('remove-task 4.1');
		expect(process.exitCode).toBe(1);
	});
});
