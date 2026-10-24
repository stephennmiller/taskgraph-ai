/**
 * @fileoverview Tests for the research MCP tool: the arguments it hands
 * tm-core and the reply shape the legacy tool had. tm-core is faked at the
 * createTmCore boundary; everything else is real.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const tasks = { research: vi.fn() };
const config = { getActiveTag: vi.fn(() => 'master') };

vi.mock('@tm/core', async (importOriginal) => ({
	...(await importOriginal<typeof import('@tm/core')>()),
	createTmCore: vi.fn(async () => ({ tasks, config }))
}));

import { registerResearchTool } from './research.tool.js';

type Tool = {
	name: string;
	parameters: { safeParse: (v: unknown) => { success: boolean } };
	execute: (args: Record<string, unknown>, ctx: unknown) => Promise<any>;
};

function register(): Tool {
	const registered: Tool[] = [];
	registerResearchTool({
		addTool: (tool: Tool) => registered.push(tool)
	} as any);
	return registered[0];
}

const ctx = {
	log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
	session: { env: { KEY: 'v' } }
};

const coreResult = {
	query: 'q',
	result: 'Use Postgres',
	contextSize: 40,
	contextTokens: 10,
	tokenBreakdown: { total: 10, customContext: null, tasks: [], files: [], projectTree: null },
	systemPromptTokens: 5,
	userPromptTokens: 6,
	totalInputTokens: 11,
	detailLevel: 'medium',
	telemetryData: { totalTokens: 3 },
	tagInfo: { currentTag: 'master', availableTags: ['master'] },
	tag: 'master',
	taskIds: [],
	relatedTaskIds: [],
	exchange: {},
	saveFailures: []
};

let project: string;

beforeEach(() => {
	vi.clearAllMocks();
	vi.stubEnv('TASKGRAPH_PROJECT_ROOT', '');
	project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'research-')));
	tasks.research.mockResolvedValue({ ...coreResult });
});

afterEach(() => {
	vi.unstubAllEnvs();
	fs.rmSync(project, { recursive: true, force: true });
});

const reply = (result: any) => JSON.parse(result.content[0].text);

describe('research', () => {
	it('is registered as research with the legacy schema', () => {
		const tool = register();

		expect(tool.name).toBe('research');
		expect(
			tool.parameters.safeParse({ query: 'q', projectRoot: project }).success
		).toBe(true);
		expect(
			tool.parameters.safeParse({
				query: 'q',
				projectRoot: project,
				detailLevel: 'extreme'
			}).success
		).toBe(false);
	});

	it('hands tm-core the parsed arguments and replies with the legacy data keys', async () => {
		const result = await register().execute(
			{
				query: 'q',
				taskIds: '15, 16.2,',
				filePaths: 'src/api.js,docs/readme.md',
				customContext: 'notes',
				includeProjectTree: true,
				detailLevel: 'high',
				saveTo: '15',
				saveToFile: true,
				projectRoot: project,
				tag: 'feature'
			},
			ctx
		);

		expect(tasks.research).toHaveBeenCalledWith(
			{
				query: 'q',
				taskIds: ['15', '16.2'],
				filePaths: ['src/api.js', 'docs/readme.md'],
				customContext: 'notes',
				includeProjectTree: true,
				detailLevel: 'high',
				saveTo: '15',
				saveToFile: true,
				tag: 'feature',
				session: ctx.session,
				outputType: 'mcp'
			},
			expect.any(Object)
		);
		const body = reply(result);
		expect(Object.keys(body.data)).toEqual([
			'query',
			'result',
			'contextSize',
			'contextTokens',
			'tokenBreakdown',
			'systemPromptTokens',
			'userPromptTokens',
			'totalInputTokens',
			'detailLevel',
			'telemetryData',
			'tagInfo'
		]);
		expect(body.data.telemetryData).toEqual({ totalTokens: 3 });
		expect(body.tag).toBe('feature');
	});

	it('includes savedFilePath when the answer was saved to a file', async () => {
		tasks.research.mockResolvedValue({
			...coreResult,
			savedFilePath: `${project}/.taskgraph/docs/research/x.md`
		});

		const body = reply(
			await register().execute({ query: 'q', projectRoot: project, saveToFile: true }, ctx)
		);

		expect(body.data.savedFilePath).toBe(
			`${project}/.taskgraph/docs/research/x.md`
		);
	});

	it('warns about a failed save to a task and still succeeds', async () => {
		tasks.research.mockResolvedValue({
			...coreResult,
			saveFailures: [{ kind: 'task', id: '15', message: 'gone' }]
		});

		const result = await register().execute(
			{ query: 'q', projectRoot: project, saveTo: '15' },
			ctx
		);

		expect(result.isError).toBeUndefined();
		expect(ctx.log.warn).toHaveBeenCalledWith(
			'Error saving research to task/subtask: gone'
		);
		expect(reply(result).data.saveFailures).toEqual([
			{ kind: 'task', id: '15', message: 'gone' }
		]);
	});

	// A task save may already have happened, so an error would invite a retry that appends twice
	it('keeps the answer and reports a failed file save', async () => {
		tasks.research.mockResolvedValue({
			...coreResult,
			saveFailures: [{ kind: 'file', path: '', message: 'EACCES' }]
		});

		const result = await register().execute(
			{ query: 'q', projectRoot: project, saveToFile: true },
			ctx
		);

		expect(result.isError).toBeUndefined();
		const body = reply(result);
		expect(body.data.result).toBe(coreResult.result);
		expect(body.data.saveFailures).toEqual([
			{ kind: 'file', path: '', message: 'EACCES' }
		]);
	});

	it('replies with the error and hint tm-core threw', async () => {
		tasks.research.mockRejectedValue(
			Object.assign(new Error('src/x.js is outside the project'), {
				hint: 'Use a path inside it'
			})
		);

		const result = await register().execute(
			{ query: 'q', projectRoot: project, filePaths: '../x.js' },
			ctx
		);

		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain(
			'Error: src/x.js is outside the project. Use a path inside it'
		);
	});
});
