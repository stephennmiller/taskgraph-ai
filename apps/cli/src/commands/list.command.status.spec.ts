/**
 * @fileoverview ListTasksCommand: --status filtering and output escaping (#365, #366)
 */

import type { TmCore } from '@tm/core';
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

import { displayError } from '../utils/error-handler.js';
import { ListTasksCommand } from './list.command.js';

describe('ListTasksCommand warnings and escaping', () => {
	let consoleLogSpy: any;
	let mockTmCore: Partial<TmCore>;

	beforeEach(() => {
		consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
		mockTmCore = {
			tasks: {
				getArchivedIds: vi.fn().mockResolvedValue(new Set()),
				getNext: vi.fn().mockResolvedValue(null)
			} as any,
			config: {
				getActiveTag: vi.fn().mockReturnValue('master')
			} as any
		};
	});

	afterEach(() => {
		vi.clearAllMocks();
		consoleLogSpy.mockRestore();
	});

	describe('--status with --json or --compact (#365)', () => {
		// Storage applies a status filter when one is passed, as the real one does
		const tasks = [
			{ id: '1', title: 'Schema', status: 'done', dependencies: [] },
			{ id: '2', title: 'Auth', status: 'in-progress', dependencies: ['1'] },
			{ id: '3', title: 'Profile', status: 'pending', dependencies: ['2'] }
		];
		const tmCoreFilteringInStorage = () => ({
			tasks: {
				getArchivedIds: vi.fn().mockResolvedValue(new Set()),
				list: vi.fn(({ filter }: { filter?: { status?: string[] } } = {}) => {
					const matching = filter?.status
						? tasks.filter((task) => filter.status?.includes(task.status))
						: tasks;
					return Promise.resolve({
						tasks: matching,
						total: tasks.length,
						filtered: matching.length
					});
				}),
				getNext: vi.fn().mockResolvedValue(null)
			},
			config: { getActiveTag: vi.fn().mockReturnValue('master') }
		});

		it.each([{ json: true }, { compact: true }])(
			'does not call a dependency on a task with another status missing (%o)',
			async (format) => {
				const consoleWarnSpy = vi
					.spyOn(console, 'warn')
					.mockImplementation(() => {});
				const command = new ListTasksCommand();
				(command as any).tmCore = tmCoreFilteringInStorage();

				await (command as any).executeCommand({ status: 'pending', ...format });

				expect(consoleWarnSpy).not.toHaveBeenCalled();
				consoleWarnSpy.mockRestore();
			}
		);

		it('lists only the status asked for, with blocks counted across every status', async () => {
			const command = new ListTasksCommand();
			(command as any).tmCore = tmCoreFilteringInStorage();

			await (command as any).executeCommand({
				status: 'in-progress',
				json: true
			});

			const parsed = JSON.parse(consoleLogSpy.mock.calls[0][0]);
			expect(parsed.tasks.map((task: any) => [task.id, task.blocks])).toEqual([
				['2', ['3']]
			]);
		});
	});

	describe('compact output (#366)', () => {
		it('strips escape codes and line breaks from IDs and titles', async () => {
			const command = new ListTasksCommand();
			(command as any).tmCore = {
				...mockTmCore,
				tasks: {
					...mockTmCore.tasks,
					list: vi.fn().mockResolvedValue({
						tasks: [
							{
								id: '1',
								title: 'Fix\nlogin\u001b]0;pwned\u0007',
								status: 'pending',
								dependencies: []
							}
						],
						total: 1,
						filtered: 1
					})
				}
			};

			await (command as any).executeCommand({ compact: true });

			const output = consoleLogSpy.mock.calls.flat().join('\n');
			expect(output).toContain('Fix login');
			expect(output).not.toContain('pwned');
			expect(output).not.toContain('\u0007');
		});
	});
	describe('tags in warnings and errors (#366)', () => {
		const warned = (spy: any) => spy.mock.calls.flat().join('\n');

		it('names the tag given with --tag in the fix-dependencies hint', async () => {
			const consoleWarnSpy = vi
				.spyOn(console, 'warn')
				.mockImplementation(() => {});
			const command = new ListTasksCommand();
			(command as any).tmCore = {
				...mockTmCore,
				tasks: {
					...mockTmCore.tasks,
					list: vi.fn().mockResolvedValue({
						tasks: [
							{ id: '1', title: 'A', status: 'pending', dependencies: ['9'] }
						],
						total: 1,
						filtered: 1
					})
				}
			};

			await (command as any).executeCommand({ tag: 'feature', json: true });

			expect(warned(consoleWarnSpy)).toContain(
				'taskgraph fix-dependencies --tag feature'
			);
			consoleWarnSpy.mockRestore();
		});

		it('strips escape codes from the error when every tag fails', async () => {
			const consoleWarnSpy = vi
				.spyOn(console, 'warn')
				.mockImplementation(() => {});
			const command = new ListTasksCommand();
			(command as any).tmCore = {
				...mockTmCore,
				tasks: {
					...mockTmCore.tasks,
					list: vi
						.fn()
						.mockRejectedValue(new Error('bad\u001b]0;pwned\u0007\nfile')),
					getTagsWithStats: vi
						.fn()
						.mockResolvedValue({ tags: [{ name: 'x', taskCount: 1 }] })
				}
			};

			await (command as any).executeCommand({ allTags: true, json: true });

			const message = vi.mocked(displayError).mock.calls[0][0].message;
			expect(message).toBe(
				'Failed to fetch tasks from any tag. First error: bad file'
			);
			consoleWarnSpy.mockRestore();
		});
	});
});
