/**
 * @fileoverview Tests for the github_status and github_push MCP tools.
 * tm-core is faked at the createTmCore boundary; everything else is real.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const github = {
	status: vi.fn(),
	push: vi.fn()
};
const config = { getActiveTag: vi.fn() };

vi.mock('@tm/core', async (importOriginal) => ({
	...(await importOriginal<typeof import('@tm/core')>()),
	createTmCore: vi.fn(async () => ({ github, config }))
}));

import { registerGithubPushTool } from './push.tool.js';
import { registerGithubStatusTool } from './status.tool.js';

type Tool = {
	name: string;
	annotations: Record<string, unknown>;
	execute: (args: Record<string, unknown>, ctx: unknown) => Promise<any>;
};

function register(registerFn: (server: any) => void): Tool {
	const tools: Tool[] = [];
	registerFn({ addTool: (tool: Tool) => tools.push(tool) });
	return tools[0];
}

const ctx = {
	log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
	session: undefined
};

const projectRoot = process.cwd();

const payload = (result: any) => JSON.parse(result.content[0].text).data;

const pushResult = {
	dryRun: true,
	plan: { repo: 'o/r', steps: [], orphans: [] },
	created: 0,
	updated: 0,
	skipped: 0,
	closed: 0,
	orphans: []
};

beforeEach(() => {
	vi.clearAllMocks();
	config.getActiveTag.mockReturnValue('master');
	github.push.mockResolvedValue(pushResult);
});

describe('github_status', () => {
	it('is a read-only tool that reports the core status', async () => {
		const status = {
			ghAvailable: true,
			repo: 'o/r',
			linkedTasks: 2,
			unlinkedTasks: 3
		};
		github.status.mockResolvedValue(status);
		const tool = register(registerGithubStatusTool);

		const result = await tool.execute({ projectRoot, repo: 'o/r' }, ctx);

		expect(tool.name).toBe('github_status');
		expect(tool.annotations.readOnlyHint).toBe(true);
		expect(github.status).toHaveBeenCalledWith({ repo: 'o/r' });
		expect(payload(result)).toEqual(status);
	});

	it('returns an error result when core throws', async () => {
		github.status.mockRejectedValue(new Error('gh is not installed'));
		const tool = register(registerGithubStatusTool);

		const result = await tool.execute({ projectRoot }, ctx);

		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain('gh is not installed');
	});
});

describe('github_push', () => {
	it('previews by default and scopes to the active tag', async () => {
		const tool = register(registerGithubPushTool);

		const result = await tool.execute({ projectRoot }, ctx);

		expect(github.push).toHaveBeenCalledWith(
			expect.objectContaining({ dryRun: true, tag: 'master' })
		);
		expect(payload(result)).toEqual(pushResult);
	});

	it('writes only when dryRun is explicitly false', async () => {
		const tool = register(registerGithubPushTool);

		await tool.execute({ projectRoot, dryRun: false }, ctx);

		expect(github.push).toHaveBeenCalledWith(
			expect.objectContaining({ dryRun: false })
		);
	});

	it('passes every tag when allTags is set', async () => {
		const tool = register(registerGithubPushTool);

		await tool.execute({ projectRoot, allTags: true }, ctx);

		expect(github.push.mock.calls[0][0].tag).toBeUndefined();
	});

	it('uses an explicit tag over the active one', async () => {
		const tool = register(registerGithubPushTool);

		await tool.execute({ projectRoot, tag: 'feature-x' }, ctx);

		expect(github.push.mock.calls[0][0].tag).toBe('feature-x');
	});

	it('splits a comma separated id list', async () => {
		const tool = register(registerGithubPushTool);

		await tool.execute({ projectRoot, id: '1, 2,,3' }, ctx);

		expect(github.push.mock.calls[0][0].taskIds).toEqual(['1', '2', '3']);
	});

	it('forwards repo, includeDetails and closeOrphans', async () => {
		const tool = register(registerGithubPushTool);

		await tool.execute(
			{
				projectRoot,
				repo: 'o/r',
				includeDetails: true,
				closeOrphans: true
			},
			ctx
		);

		expect(github.push).toHaveBeenCalledWith(
			expect.objectContaining({
				repo: 'o/r',
				includeDetails: true,
				closeOrphans: true
			})
		);
	});

	it('rejects tag together with allTags without calling core', async () => {
		const tool = register(registerGithubPushTool);

		const result = await tool.execute(
			{ projectRoot, tag: 'a', allTags: true },
			ctx
		);

		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain('either tag or allTags');
		expect(github.push).not.toHaveBeenCalled();
	});

	it('returns an error result when core throws', async () => {
		github.push.mockRejectedValue(new Error('rate limited'));
		const tool = register(registerGithubPushTool);

		const result = await tool.execute({ projectRoot }, ctx);

		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain('rate limited');
	});
});
