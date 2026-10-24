/**
 * @fileoverview Tests for the tag MCP tools' replies.
 * tm-core is faked at the createTmCore boundary; everything else is real.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const tasks = {
	listTags: vi.fn(),
	createTag: vi.fn(),
	createTagFromBranch: vi.fn()
};

vi.mock('@tm/core', async (importOriginal) => ({
	...(await importOriginal<typeof import('@tm/core')>()),
	createTmCore: vi.fn(async () => ({ tasks }))
}));

import { ERROR_CODES, TaskGraphError } from '@tm/core';
import { registerAddTagTool, registerListTagsTool } from './tags.tool.js';

type Tool = {
	execute: (args: Record<string, unknown>, ctx: unknown) => Promise<any>;
};

function register(registerTool: (server: any) => void): Tool {
	const registered: Tool[] = [];
	registerTool({ addTool: (tool: Tool) => registered.push(tool) });
	return registered[0];
}

const ctx = {
	log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
	session: undefined
};
const projectRoot = process.cwd();
const payload = (result: any) => JSON.parse(result.content[0].text).data;

beforeEach(() => {
	vi.clearAllMocks();
});

describe('list_tags', () => {
	it('replies with each tag without its ready count', async () => {
		const tag = {
			name: 'master',
			isCurrent: true,
			taskCount: 2,
			completedTasks: 1,
			readyTasks: 1,
			statusBreakdown: { done: 1, pending: 1 },
			subtaskCounts: { totalSubtasks: 0, subtasksByStatus: {} },
			created: 'Unknown',
			description: 'No description'
		};
		tasks.listTags.mockResolvedValue({
			tags: [tag],
			currentTag: 'master',
			totalTags: 1
		});

		const result = await register(registerListTagsTool).execute(
			{ projectRoot },
			ctx
		);

		const { readyTasks: _, ...listed } = tag;
		expect(payload(result)).toEqual({
			tags: [listed],
			currentTag: 'master',
			totalTags: 1,
			message: 'Found 1 tag(s)'
		});
	});
});

describe('add_tag', () => {
	it('words a fromBranch outside a git repository for MCP', async () => {
		tasks.createTagFromBranch.mockRejectedValue(
			new TaskGraphError('Not in a git repository', ERROR_CODES.NOT_GIT_REPO)
		);

		const result = await register(registerAddTagTool).execute(
			{ projectRoot, name: 'x', fromBranch: true },
			ctx
		);

		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain(
			'Error: Not in a git repository. Cannot use fromBranch option.'
		);
		expect(tasks.createTag).not.toHaveBeenCalled();
	});

	it('replies with what was created', async () => {
		tasks.createTag.mockResolvedValue({
			tagName: 'sprint',
			created: true,
			tasksCopied: 0,
			sourceTag: null,
			description: 'Tag created on 1/1/2026'
		});

		const result = await register(registerAddTagTool).execute(
			{ projectRoot, name: 'sprint' },
			ctx
		);

		expect(payload(result)).toEqual({
			tagName: 'sprint',
			created: true,
			tasksCopied: 0,
			sourceTag: null,
			description: 'Tag created on 1/1/2026',
			message: 'Successfully created tag "sprint"'
		});
	});
});
