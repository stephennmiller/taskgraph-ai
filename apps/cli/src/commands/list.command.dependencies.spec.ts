/**
 * @fileoverview ListTasksCommand: warnings about invalid dependencies
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock dependencies - use importOriginal to preserve real implementations
// Only mock createTmCore since we inject a mock tmCore directly in tests
vi.mock('@tm/core', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@tm/core')>();
	return {
		...actual,
		createTmCore: vi.fn()
	};
});

vi.mock('../utils/project-root.js', () => ({
	getProjectRoot: vi.fn((path?: string) => path || '/test/project')
}));

vi.mock('../utils/error-handler.js', () => ({
	displayError: vi.fn()
}));

vi.mock('../utils/display-helpers.js', () => ({
	displayCommandHeader: vi.fn()
}));

vi.mock('../utils/ui.js', () => ({
	createTaskTable: vi.fn(() => 'Table output')
}));

import { ListTasksCommand } from './list.command.js';

describe('ListTasksCommand', () => {
	let consoleLogSpy: any;

	beforeEach(() => {
		consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
	});

	afterEach(() => {
		vi.clearAllMocks();
		consoleLogSpy.mockRestore();
	});

	describe('buildBlocksMap validation', () => {
		it('should warn about dependencies to non-existent tasks', async () => {
			const consoleWarnSpy = vi
				.spyOn(console, 'warn')
				.mockImplementation(() => {});
			const command = new ListTasksCommand();

			const mockTasks = [
				{
					id: '1',
					title: 'Task with bad dep',
					status: 'pending',
					dependencies: ['999']
				}
			];

			(command as any).tmCore = {
				tasks: {
					getArchivedIds: vi.fn().mockResolvedValue(new Set()),
					list: vi.fn().mockResolvedValue({
						tasks: mockTasks,
						total: 1,
						filtered: 1
					})
				},
				config: {
					getActiveTag: vi.fn().mockReturnValue('master')
				}
			};

			await (command as any).executeCommand({
				json: true
			});

			// Verify console.warn was called with warning about invalid dependency
			expect(consoleWarnSpy).toHaveBeenCalled();

			// Find the call that mentions invalid dependency references
			const warnCalls = consoleWarnSpy.mock.calls.map((call) => call[0]);
			const hasInvalidDepWarning = warnCalls.some(
				(msg) =>
					typeof msg === 'string' &&
					msg.includes('invalid dependency reference')
			);
			const hasSpecificTaskWarning = warnCalls.some(
				(msg) =>
					typeof msg === 'string' &&
					msg.includes('Task 1') &&
					msg.includes('999')
			);

			expect(hasInvalidDepWarning).toBe(true);
			expect(hasSpecificTaskWarning).toBe(true);

			consoleWarnSpy.mockRestore();
		});

		it('does not warn about a dependency on a subtask the rows leave out (#657)', async () => {
			const consoleWarnSpy = vi
				.spyOn(console, 'warn')
				.mockImplementation(() => {});
			const command = new ListTasksCommand();
			const tasks = [
				{
					id: '1',
					title: 'Parent',
					status: 'pending',
					dependencies: [],
					subtasks: [{ id: 1, title: 'Sub', status: 'pending' }]
				},
				{ id: '2', title: 'Waiting', status: 'pending', dependencies: ['1.1'] }
			];
			(command as any).tmCore = {
				tasks: {
					getArchivedIds: vi.fn().mockResolvedValue(new Set()),
					// As storage does: includeSubtasks false empties them
					list: vi.fn(async ({ includeSubtasks }) => ({
						tasks:
							includeSubtasks === false
								? tasks.map((task) => ({ ...task, subtasks: [] }))
								: tasks,
						total: 2,
						filtered: 2
					}))
				},
				config: { getActiveTag: vi.fn().mockReturnValue('master') }
			};

			await (command as any).executeCommand({ json: true, format: 'json' });

			expect(consoleWarnSpy).not.toHaveBeenCalled();
			const output = JSON.parse(consoleLogSpy.mock.calls[0][0]);
			expect(output.tasks[0].subtasks).toEqual([]);

			consoleWarnSpy.mockRestore();
		});
	});
});

describe('ListTasksCommand with escape sequences in task text (#287)', () => {
	const hostile = 'Fix\x1b[2J\x1b]0;pwned\x07 login';
	let logSpy: ReturnType<typeof vi.spyOn>;
	let command: ListTasksCommand;

	beforeEach(() => {
		logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
		command = new ListTasksCommand();
		(command as any).tmCore = {
			tasks: {
				getArchivedIds: vi.fn().mockResolvedValue(new Set()),
				list: vi.fn().mockResolvedValue({
					tasks: [{ id: '1', title: hostile, status: 'pending' }],
					total: 1,
					filtered: 1
				}),
				getNext: vi.fn().mockResolvedValue(null)
			},
			config: { getActiveTag: vi.fn().mockReturnValue('master') }
		};
	});

	afterEach(() => {
		logSpy.mockRestore();
	});

	it('prints compact titles without them', async () => {
		await (command as any).executeCommand({ compact: true });

		const output = logSpy.mock.calls
			.map((call: unknown[]) => String(call[0]))
			.join('\n');
		expect(output.replace(/\x1b\[[0-9;]*m/g, '')).toContain('Fix login');
		expect(output).not.toContain('pwned');
	});

	it('keeps the stored text in JSON, where the escapes are escaped', async () => {
		await (command as any).executeCommand({ json: true });

		const parsed = JSON.parse(String(logSpy.mock.calls[0][0]));
		expect(parsed.tasks[0].title).toBe(hostile);
	});
});
