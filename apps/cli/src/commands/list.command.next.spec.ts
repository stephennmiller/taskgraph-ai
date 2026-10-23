/**
 * @fileoverview The summary and `Next:` line `list` prints come from
 * tm-core's `next` pick and count the whole tag, subtasks included (#246)
 */

import type { Task, TmCore } from '@tm/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tm/core', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@tm/core')>();
	return { ...actual, createTmCore: vi.fn() };
});

vi.mock('../utils/error-handler.js', () => ({ displayError: vi.fn() }));
vi.mock('../utils/display-helpers.js', () => ({
	displayCommandHeader: vi.fn()
}));
vi.mock('../utils/ui.js', () => ({
	createTaskTable: vi.fn(() => 'Table output'),
	displayWarning: vi.fn()
}));

import { createTaskTable } from '../utils/ui.js';
import { ListTasksCommand } from './list.command.js';

const strip = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, '');

const tasks = [1, 2, 3, 4].map((id) => ({
	id: String(id),
	title: `Task ${id}`,
	status: 'pending',
	priority: 'medium',
	dependencies: id > 2 ? ['2'] : [],
	subtasks: []
})) as unknown as Task[];

/** Task 2 has three subtasks, one done; `next` picks subtask 2.2 */
const withSubtasks = tasks.map((task) =>
	task.id === '2'
		? {
				...task,
				status: 'in-progress',
				subtasks: [
					{ id: 1, title: 'Schema', status: 'done', dependencies: [] },
					{
						id: 2,
						title: 'Sessions table',
						status: 'pending',
						dependencies: []
					},
					{ id: 3, title: 'Logout', status: 'pending', dependencies: [] }
				]
			}
		: task
) as unknown as Task[];

const subtaskPick = {
	id: '2.2',
	title: 'Sessions table',
	status: 'pending',
	priority: 'high',
	dependencies: [],
	parentId: '2'
} as unknown as Task;

const tableRows = () =>
	vi.mocked(createTaskTable).mock.calls[0][0] as unknown as Task[];

describe('ListTasksCommand summary and next step', () => {
	let consoleLogSpy: ReturnType<typeof vi.spyOn>;
	let list: ReturnType<typeof vi.fn>;
	let getNext: ReturnType<typeof vi.fn>;
	let command: ListTasksCommand;

	const printed = () =>
		strip(
			consoleLogSpy.mock.calls
				.map((call: unknown[]) => String(call[0]))
				.join('\n')
		);

	beforeEach(() => {
		consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
		list = vi.fn().mockResolvedValue({ tasks, total: 4, filtered: 4 });
		getNext = vi.fn().mockResolvedValue(tasks[1]);
		command = new ListTasksCommand();
		(command as any).tmCore = {
			tasks: { list, getNext },
			config: { getActiveTag: () => 'master' }
		} as unknown as TmCore;
	});

	afterEach(() => {
		vi.clearAllMocks();
		consoleLogSpy.mockRestore();
	});

	it('shows the task tm-core picks, not its own ordering', async () => {
		// The old list ordering would have recommended 1
		await (command as any).executeCommand({ tag: 'dev' });

		expect(getNext).toHaveBeenCalledWith('dev');
		expect(printed()).toMatch(/Next {6}2 {2}Task 2/);
		expect(printed()).toContain(
			'Next: taskgraph set-status --id=2 --status=in-progress'
		);
	});

	it('says nothing is ready and prints no Next: line when tm-core has none', async () => {
		getNext.mockResolvedValue(null);

		await (command as any).executeCommand({});

		expect(printed()).toContain('nothing is ready to start');
		expect(printed()).not.toContain('Next: ');
	});

	it('skips the lookup for JSON output', async () => {
		await (command as any).executeCommand({ json: true });

		expect(getNext).not.toHaveBeenCalled();
	});

	it('prints no boxes', async () => {
		await (command as any).executeCommand({});

		expect(printed()).not.toMatch(/[╭╮╰╯]/);
	});

	describe('#246 regressions', () => {
		beforeEach(() => {
			list.mockResolvedValue({ tasks: withSubtasks, total: 4, filtered: 4 });
		});

		it('shows the subtask `next` picks instead of "No task available"', async () => {
			getNext.mockResolvedValue(subtaskPick);

			await (command as any).executeCommand({});

			const output = printed();
			expect(output).toMatch(/Next {6}2\.2 {2}Sessions table/);
			expect(output).not.toContain('No task available');
			expect(output).not.toContain('nothing is ready');
			expect(output).toContain(
				'Next: taskgraph set-status --id=2.2 --status=in-progress'
			);
		});

		it('counts subtasks without --with-subtasks', async () => {
			// Commander sets withSubtasks to false when the flag is absent
			await (command as any).executeCommand({ withSubtasks: false });

			// The summary needs subtasks loaded even though the table hides them
			expect(list).toHaveBeenCalledWith(
				expect.objectContaining({ includeSubtasks: true })
			);
			expect(printed()).toMatch(/Subtasks .* 1 of 3 done · 33%/);
			// The table still gets the tasks without their subtasks
			expect(tableRows().find((t) => t.id === '2')?.subtasks).toEqual([]);
		});

		it('keeps subtasks in the table with --with-subtasks', async () => {
			await (command as any).executeCommand({ withSubtasks: true });

			expect(tableRows().find((t) => t.id === '2')?.subtasks).toHaveLength(3);
		});

		it('counts the whole tag when a status filter narrows the table', async () => {
			await (command as any).executeCommand({ status: 'in-progress' });

			// Fetched without the filter, so the summary sees every task
			expect(list).toHaveBeenCalledWith(
				expect.objectContaining({ filter: undefined })
			);
			expect(printed()).toMatch(/Tasks .* 0 of 4 done/);
			expect(tableRows().map((t) => t.id)).toEqual(['2']);
		});
	});
});
