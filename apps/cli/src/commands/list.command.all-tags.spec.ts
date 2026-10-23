/**
 * @fileoverview Unit tests for ListTasksCommand --all-tags
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

	describe('--all-tags option', () => {
		it('should fetch tasks from multiple tags and include tagName field', async () => {
			const command = new ListTasksCommand();

			// Mock tasks for different tags
			const featureATasksResponse = {
				tasks: [
					{
						id: '1',
						title: 'Feature A Task 1',
						status: 'pending',
						dependencies: []
					},
					{
						id: '2',
						title: 'Feature A Task 2',
						status: 'done',
						dependencies: []
					}
				],
				total: 2,
				filtered: 2
			};

			const featureBTasksResponse = {
				tasks: [
					{
						id: '1',
						title: 'Feature B Task 1',
						status: 'in-progress',
						dependencies: []
					},
					{
						id: '2',
						title: 'Feature B Task 2',
						status: 'pending',
						dependencies: ['1']
					}
				],
				total: 2,
				filtered: 2
			};

			const listMock = vi
				.fn()
				.mockResolvedValueOnce(featureATasksResponse)
				.mockResolvedValueOnce(featureBTasksResponse);

			(command as any).tmCore = {
				tasks: {
					getArchivedIds: vi.fn().mockResolvedValue(new Set()),
					list: listMock,
					getTagsWithStats: vi.fn().mockResolvedValue({
						tags: [
							{ name: 'feature-a', taskCount: 2 },
							{ name: 'feature-b', taskCount: 2 }
						]
					})
				},
				config: {
					getActiveTag: vi.fn().mockReturnValue('master')
				}
			};

			await (command as any).executeCommand({
				allTags: true,
				json: true
			});

			const output = consoleLogSpy.mock.calls[0][0];
			const parsed = JSON.parse(output);

			// Should include tasks from both tags
			expect(parsed.tasks).toHaveLength(4);

			// Each task should have tagName field
			const featureATasks = parsed.tasks.filter(
				(t: any) => t.tagName === 'feature-a'
			);
			const featureBTasks = parsed.tasks.filter(
				(t: any) => t.tagName === 'feature-b'
			);

			expect(featureATasks).toHaveLength(2);
			expect(featureBTasks).toHaveLength(2);

			// Verify metadata indicates all tags
			expect(parsed.metadata.allTags).toBe(true);
			expect(parsed.metadata.tag).toBe('all');
			expect(parsed.metadata.total).toBe(4);
		});

		it('should apply --ready filter per-tag when combined with --all-tags', async () => {
			const command = new ListTasksCommand();

			// Tag A: Task 1 is done, Task 2 depends on Task 1 (ready)
			const tagATasksResponse = {
				tasks: [
					{ id: '1', title: 'Tag A Task 1', status: 'done', dependencies: [] },
					{
						id: '2',
						title: 'Tag A Task 2',
						status: 'pending',
						dependencies: ['1']
					}
				],
				total: 2,
				filtered: 2
			};

			// Tag B: Task 1 is pending (ready), Task 2 depends on Task 1 (not ready)
			// Note: Task IDs can overlap between tags, but dependencies are tag-scoped
			const tagBTasksResponse = {
				tasks: [
					{
						id: '1',
						title: 'Tag B Task 1',
						status: 'pending',
						dependencies: []
					},
					{
						id: '2',
						title: 'Tag B Task 2',
						status: 'pending',
						dependencies: ['1']
					}
				],
				total: 2,
				filtered: 2
			};

			const listMock = vi
				.fn()
				.mockResolvedValueOnce(tagATasksResponse)
				.mockResolvedValueOnce(tagBTasksResponse);

			(command as any).tmCore = {
				tasks: {
					getArchivedIds: vi.fn().mockResolvedValue(new Set()),
					list: listMock,
					getTagsWithStats: vi.fn().mockResolvedValue({
						tags: [
							{ name: 'tag-a', taskCount: 2 },
							{ name: 'tag-b', taskCount: 2 }
						]
					})
				},
				config: {
					getActiveTag: vi.fn().mockReturnValue('master')
				}
			};

			await (command as any).executeCommand({
				allTags: true,
				ready: true,
				json: true
			});

			const output = consoleLogSpy.mock.calls[0][0];
			const parsed = JSON.parse(output);

			// Tag A: Task 2 is ready (Task 1 is done)
			// Tag B: Task 1 is ready (no deps), Task 2 is NOT ready (Task 1 is pending)
			expect(parsed.tasks).toHaveLength(2);

			const taskIds = parsed.tasks.map((t: any) => `${t.tagName}:${t.id}`);
			expect(taskIds).toContain('tag-a:2'); // Ready: deps satisfied
			expect(taskIds).toContain('tag-b:1'); // Ready: no deps
			expect(taskIds).not.toContain('tag-b:2'); // Not ready: depends on pending task
		});

		it('should reject --all-tags combined with --watch', () => {
			const consoleErrorSpy = vi
				.spyOn(console, 'error')
				.mockImplementation(() => {});
			const command = new ListTasksCommand();

			const isValid = (command as any).validateOptions({
				allTags: true,
				watch: true
			});

			expect(isValid).toBe(false);
			expect(consoleErrorSpy).toHaveBeenCalledWith(
				expect.stringContaining('--all-tags cannot be used with --watch mode')
			);

			consoleErrorSpy.mockRestore();
		});

		it('should apply --blocking filter with --all-tags', async () => {
			const command = new ListTasksCommand();

			// Tag A: Task 1 blocks Task 2
			const tagATasksResponse = {
				tasks: [
					{
						id: '1',
						title: 'Tag A Task 1',
						status: 'pending',
						dependencies: []
					},
					{
						id: '2',
						title: 'Tag A Task 2',
						status: 'pending',
						dependencies: ['1']
					}
				],
				total: 2,
				filtered: 2
			};

			// Tag B: Task 1 blocks nothing (no other tasks depend on it)
			const tagBTasksResponse = {
				tasks: [
					{
						id: '1',
						title: 'Tag B Task 1',
						status: 'pending',
						dependencies: []
					}
				],
				total: 1,
				filtered: 1
			};

			const listMock = vi
				.fn()
				.mockResolvedValueOnce(tagATasksResponse)
				.mockResolvedValueOnce(tagBTasksResponse);

			(command as any).tmCore = {
				tasks: {
					getArchivedIds: vi.fn().mockResolvedValue(new Set()),
					list: listMock,
					getTagsWithStats: vi.fn().mockResolvedValue({
						tags: [
							{ name: 'tag-a', taskCount: 2 },
							{ name: 'tag-b', taskCount: 1 }
						]
					})
				},
				config: {
					getActiveTag: vi.fn().mockReturnValue('master')
				}
			};

			await (command as any).executeCommand({
				allTags: true,
				blocking: true,
				json: true
			});

			const output = consoleLogSpy.mock.calls[0][0];
			const parsed = JSON.parse(output);

			// Only Tag A Task 1 blocks other tasks
			expect(parsed.tasks).toHaveLength(1);
			expect(parsed.tasks[0].tagName).toBe('tag-a');
			expect(parsed.tasks[0].id).toBe('1');
			expect(parsed.tasks[0].blocks).toContain('2');
		});

		it('should apply status filter with --all-tags', async () => {
			const command = new ListTasksCommand();

			const tagATasksResponse = {
				tasks: [
					{
						id: '1',
						title: 'Tag A Task 1',
						status: 'pending',
						dependencies: []
					},
					{ id: '2', title: 'Tag A Task 2', status: 'done', dependencies: [] }
				],
				total: 2,
				filtered: 2
			};

			const tagBTasksResponse = {
				tasks: [
					{
						id: '1',
						title: 'Tag B Task 1',
						status: 'in-progress',
						dependencies: []
					},
					{
						id: '2',
						title: 'Tag B Task 2',
						status: 'pending',
						dependencies: []
					}
				],
				total: 2,
				filtered: 2
			};

			const listMock = vi
				.fn()
				.mockResolvedValueOnce(tagATasksResponse)
				.mockResolvedValueOnce(tagBTasksResponse);

			(command as any).tmCore = {
				tasks: {
					getArchivedIds: vi.fn().mockResolvedValue(new Set()),
					list: listMock,
					getTagsWithStats: vi.fn().mockResolvedValue({
						tags: [
							{ name: 'tag-a', taskCount: 2 },
							{ name: 'tag-b', taskCount: 2 }
						]
					})
				},
				config: {
					getActiveTag: vi.fn().mockReturnValue('master')
				}
			};

			await (command as any).executeCommand({
				allTags: true,
				status: 'pending',
				json: true
			});

			const output = consoleLogSpy.mock.calls[0][0];
			const parsed = JSON.parse(output);

			// Only pending tasks should be included
			expect(parsed.tasks).toHaveLength(2);
			expect(parsed.tasks.every((t: any) => t.status === 'pending')).toBe(true);

			const taskIds = parsed.tasks.map((t: any) => `${t.tagName}:${t.id}`);
			expect(taskIds).toContain('tag-a:1');
			expect(taskIds).toContain('tag-b:2');
		});
	});
});
