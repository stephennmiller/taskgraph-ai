/**
 * @fileoverview The list command's recommended next task comes from tm-core
 */

import type { TmCore } from '@tm/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tm/core', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@tm/core')>();
	return { ...actual, createTmCore: vi.fn() };
});

vi.mock('../utils/error-handler.js', () => ({ displayError: vi.fn() }));
vi.mock('../utils/display-helpers.js', () => ({
	displayCommandHeader: vi.fn()
}));
vi.mock('../ui/index.js', () => ({
	calculateDependencyStatistics: vi.fn(() => ({ total: 0, blocked: 0 })),
	calculateSubtaskStatistics: vi.fn(() => ({ total: 0, completed: 0 })),
	calculateTaskStatistics: vi.fn(() => ({ total: 0, completed: 0 })),
	displayDashboards: vi.fn(),
	displayRecommendedNextTask: vi.fn(),
	displaySuggestedNextSteps: vi.fn(),
	getPriorityBreakdown: vi.fn(() => ({})),
	getTaskDescription: vi.fn(() => 'Test description')
}));
vi.mock('../utils/ui.js', () => ({
	createTaskTable: vi.fn(() => 'Table output'),
	displayWarning: vi.fn()
}));

import { displayRecommendedNextTask } from '../ui/index.js';
import { ListTasksCommand } from './list.command.js';

const tasks = [1, 2, 3, 4].map((id) => ({
	id: String(id),
	title: `Task ${id}`,
	status: 'pending',
	priority: 'medium',
	dependencies: id > 2 ? ['2'] : [],
	subtasks: []
}));

describe('ListTasksCommand recommended next task', () => {
	let consoleLogSpy: ReturnType<typeof vi.spyOn>;
	let list: ReturnType<typeof vi.fn>;
	let getNext: ReturnType<typeof vi.fn>;
	let command: ListTasksCommand;

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
		expect(displayRecommendedNextTask).toHaveBeenCalledWith(
			expect.objectContaining({ id: '2' })
		);
	});

	it('shows no recommendation when tm-core has none', async () => {
		getNext.mockResolvedValue(null);

		await (command as any).executeCommand({});

		expect(displayRecommendedNextTask).not.toHaveBeenCalled();
	});

	it('skips the lookup for JSON output', async () => {
		await (command as any).executeCommand({ json: true });

		expect(getNext).not.toHaveBeenCalled();
	});
});
