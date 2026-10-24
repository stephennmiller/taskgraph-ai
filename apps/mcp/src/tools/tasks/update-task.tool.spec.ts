/**
 * @fileoverview Tests for the update_task and update MCP tools: the
 * arguments they hand tm-core and the reply shapes the legacy tools had.
 * tm-core is faked at the createTmCore boundary; everything else is real.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const tasks = { updateWithPrompt: vi.fn(), updateFrom: vi.fn() };
const config = { getActiveTag: vi.fn(() => 'master') };

vi.mock('@tm/core', async (importOriginal) => ({
	...(await importOriginal<typeof import('@tm/core')>()),
	createTmCore: vi.fn(async () => ({ tasks, config }))
}));

import { registerUpdateTaskTool, registerUpdateTool } from './update-task.tool.js';

type Tool = {
	name: string;
	execute: (args: Record<string, unknown>, ctx: unknown) => Promise<any>;
};

function register(fn: (server: any) => void): Tool {
	const registered: Tool[] = [];
	fn({ addTool: (tool: Tool) => registered.push(tool) });
	return registered[0];
}

const ctx = {
	log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
	session: { env: { KEY: 'v' } }
};
const reply = (result: any) => JSON.parse(result.content[0].text);
const text = (result: any) => result.content[0].text as string;
const tagInfo = { currentTag: 'master', availableTags: ['master'] };
const savedTask = { id: '3', title: 'Auth', subtasks: [{ id: 1 }] };

let project: string;

beforeEach(() => {
	vi.clearAllMocks();
	vi.stubEnv('TASKGRAPH_PROJECT_ROOT', '');
	vi.stubEnv('TASKGRAPH_ALLOW_METADATA_UPDATES', 'true');
	project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'upd-')));
	tasks.updateWithPrompt.mockResolvedValue({
		task: savedTask,
		tag: 'master',
		telemetryData: { totalTokens: 3 },
		tagInfo
	});
	tasks.updateFrom.mockResolvedValue({
		tag: 'master',
		sentCount: 2,
		updatedTasks: [savedTask, { id: '4', title: 'Docs' }],
		telemetryData: { totalTokens: 5 },
		tagInfo
	});
});

afterEach(() => {
	vi.unstubAllEnvs();
	fs.rmSync(project, { recursive: true, force: true });
});

describe('update_task', () => {
	const tool = () => register(registerUpdateTaskTool);

	it('hands tm-core the arguments and replies as before', async () => {
		const result = await tool().execute(
			{
				id: '3',
				prompt: 'Use OAuth',
				research: true,
				append: true,
				metadata: '{"sprint": 2}',
				projectRoot: project
			},
			ctx
		);

		expect(tool().name).toBe('update_task');
		expect(tasks.updateWithPrompt).toHaveBeenCalledWith(
			{
				id: '3',
				prompt: 'Use OAuth',
				research: true,
				append: true,
				metadata: { sprint: 2 },
				tag: 'master',
				session: ctx.session,
				outputType: 'mcp'
			},
			expect.any(Object)
		);
		expect(reply(result)).toMatchObject({
			data: {
				message: 'Successfully updated task with ID 3 based on the prompt',
				taskId: '3',
				tasksPath: path.join(project, '.taskgraph', 'tasks', 'tasks.json'),
				useResearch: true,
				updated: true,
				updatedTask: { ...savedTask, id: 3 },
				telemetryData: { totalTokens: 3 },
				tagInfo
			},
			tag: 'master'
		});
	});

	it('replies that a done task was not updated, without failing', async () => {
		tasks.updateWithPrompt.mockResolvedValue({
			task: savedTask,
			tag: 'master',
			skipped: 'done',
			telemetryData: null,
			tagInfo: null
		});

		const result = await tool().execute(
			{ id: '3', prompt: 'x', projectRoot: project },
			ctx
		);

		expect(result.isError).toBeFalsy();
		expect(reply(result).data).toEqual({
			message: 'Task 3 was not updated (likely already completed).',
			taskId: '3',
			updated: false
		});
		expect(ctx.log.warn).toHaveBeenCalledWith(
			'Task 3 is already marked as done and cannot be updated'
		);
	});

	it('names the tag for a metadata-only update, which makes no AI call', async () => {
		tasks.updateWithPrompt.mockResolvedValue({
			task: savedTask,
			tag: 'master',
			telemetryData: null,
			tagInfo: null
		});

		const result = await tool().execute(
			{ id: '3', metadata: '{"sprint": 2}', projectRoot: project },
			ctx
		);

		expect(reply(result).data.tagInfo).toEqual({ tag: 'master' });
		expect(reply(result).data.updatedTask.id).toBe(3);
	});

	it.each([
		[{}, 'Either prompt or metadata must be provided for update-task'],
		[{ metadata: '[1]' }, 'Invalid metadata: must be a JSON object']
	])('refuses %o without calling tm-core', async (args, message) => {
		const result = await tool().execute(
			{ id: '3', projectRoot: project, ...args },
			ctx
		);

		expect(result.isError).toBe(true);
		expect(text(result)).toContain(message);
		expect(tasks.updateWithPrompt).not.toHaveBeenCalled();
	});

	it("refuses a file other than the project's tasks.json", async () => {
		const result = await tool().execute(
			{ id: '3', prompt: 'x', file: '/tmp/other.json', projectRoot: project },
			ctx
		);

		expect(result.isError).toBe(true);
		expect(text(result)).toContain("a different file isn't supported");
		expect(tasks.updateWithPrompt).not.toHaveBeenCalled();
	});

	it('replies with the error tm-core threw', async () => {
		tasks.updateWithPrompt.mockRejectedValue(new Error('Task 9 not found'));

		const result = await tool().execute(
			{ id: '9', prompt: 'x', projectRoot: project },
			ctx
		);

		expect(result.isError).toBe(true);
		expect(text(result)).toContain('Task 9 not found');
	});
});

describe('update', () => {
	const tool = () => register(registerUpdateTool);

	it('hands tm-core the arguments and replies with the count', async () => {
		const result = await tool().execute(
			{ from: '3', prompt: 'Use TypeScript', tag: 'feature', projectRoot: project },
			ctx
		);

		expect(tool().name).toBe('update');
		expect(tasks.updateFrom).toHaveBeenCalledWith(
			{
				from: '3',
				prompt: 'Use TypeScript',
				research: false,
				tag: 'feature',
				session: ctx.session,
				outputType: 'mcp'
			},
			expect.any(Object)
		);
		expect(reply(result).data).toEqual({
			message: 'Successfully updated 2 tasks.',
			tasksPath: path.join(project, '.taskgraph', 'tasks', 'tasks.json'),
			updatedCount: 2,
			telemetryData: { totalTokens: 5 },
			tagInfo
		});
	});

	it('fails when no unfinished task is from the ID on', async () => {
		tasks.updateFrom.mockResolvedValue({
			tag: 'master',
			sentCount: 0,
			updatedTasks: [],
			telemetryData: null,
			tagInfo: null
		});

		const result = await tool().execute(
			{ from: '9', prompt: 'x', projectRoot: project },
			ctx
		);

		expect(result.isError).toBe(true);
		expect(text(result)).toContain(
			'No tasks to update: none from 9 on are unfinished'
		);
	});
});
