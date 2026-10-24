/**
 * @fileoverview Tests for the expand_task and expand_all MCP tools: the
 * arguments they hand tm-core and the reply shapes the legacy tools had.
 * tm-core is faked at the createTmCore boundary; everything else is real.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const tasks = { expand: vi.fn(), expandAll: vi.fn() };
const config = { getActiveTag: vi.fn(() => 'master') };

vi.mock('@tm/core', async (importOriginal) => ({
	...(await importOriginal<typeof import('@tm/core')>()),
	createTmCore: vi.fn(async () => ({ tasks, config }))
}));

import {
	registerExpandAllTool,
	registerExpandTaskTool
} from './expand.tool.js';

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
const savedTask = {
	id: '3',
	title: 'Auth',
	subtasks: [{ id: 1 }, { id: 2 }]
};

let project: string;

beforeEach(() => {
	vi.clearAllMocks();
	vi.stubEnv('TASKGRAPH_PROJECT_ROOT', '');
	project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'exp-')));
	tasks.expand.mockResolvedValue({
		task: savedTask,
		tag: 'master',
		addedSubtasks: savedTask.subtasks,
		hadSubtasks: true,
		telemetryData: { totalTokens: 3 },
		tagInfo: { currentTag: 'master', availableTags: ['master'] }
	});
});

afterEach(() => {
	vi.unstubAllEnvs();
	fs.rmSync(project, { recursive: true, force: true });
});

describe('expand_task', () => {
	const tool = () => register(registerExpandTaskTool);

	it('hands tm-core the arguments with the MCP rules and replies as before', async () => {
		const result = await tool().execute(
			{
				id: '3',
				num: '2',
				research: true,
				prompt: 'More',
				force: true,
				projectRoot: project
			},
			ctx
		);

		expect(tasks.expand).toHaveBeenCalledWith(
			{
				id: '3',
				num: '2',
				research: true,
				prompt: 'More',
				force: true,
				tag: 'master',
				session: ctx.session,
				outputType: 'mcp',
				keepExpanded: true
			},
			expect.any(Object)
		);
		expect(tool().name).toBe('expand_task');
		expect(reply(result)).toMatchObject({
			data: {
				task: savedTask,
				subtasksAdded: 2,
				hasExistingSubtasks: true,
				telemetryData: { totalTokens: 3 },
				tagInfo: { currentTag: 'master', availableTags: ['master'] }
			},
			tag: 'master'
		});
	});

	it('replies that expansion was skipped for a task with subtasks', async () => {
		tasks.expand.mockResolvedValue({
			task: savedTask,
			tag: 'master',
			addedSubtasks: [],
			skipped: 'has-subtasks',
			hadSubtasks: true,
			telemetryData: null,
			tagInfo: null
		});

		const result = await tool().execute({ id: '3', projectRoot: project }, ctx);

		expect(reply(result).data).toEqual({
			message: 'Task 3 already has subtasks. Expansion skipped.',
			// The legacy reply read the task with a number ID
			task: { ...savedTask, id: 3 },
			subtasksAdded: 0,
			hasExistingSubtasks: true
		});
	});

	it('leaves telemetry out when the complexity report skipped the task', async () => {
		tasks.expand.mockResolvedValue({
			task: { id: '3', subtasks: [] },
			tag: 'master',
			addedSubtasks: [],
			skipped: 'complexity-report',
			hadSubtasks: false,
			telemetryData: null,
			tagInfo: null
		});

		const result = await tool().execute({ id: '3', projectRoot: project }, ctx);

		expect(reply(result).data).toEqual({
			task: { id: 3, subtasks: [] },
			subtasksAdded: 0,
			hasExistingSubtasks: false
		});
	});

	it('returns a tm-core failure as an error with the tag', async () => {
		tasks.expand.mockRejectedValue(
			new Error('Task 6 is already marked as done and cannot be expanded')
		);

		const result = await tool().execute({ id: '6', projectRoot: project }, ctx);

		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain(
			'Error: Task 6 is already marked as done and cannot be expanded'
		);
		expect(result.content[0].text).toContain('Current Tag: master');
	});

	it("adds the error's hint, so a misspelled tag points to `taskgraph tags` (#548)", async () => {
		tasks.expand.mockRejectedValue(
			Object.assign(new Error('Tag "featuer" not found'), {
				hint: 'Run `taskgraph tags` to see your tags'
			})
		);

		const result = await tool().execute(
			{ id: '2', tag: 'featuer', projectRoot: project },
			ctx
		);

		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain(
			'Error: Tag "featuer" not found. Run `taskgraph tags` to see your tags'
		);
	});

	it('refuses a tasks file other than the project tasks.json', async () => {
		const result = await tool().execute(
			{ id: '3', file: 'other.json', projectRoot: project },
			ctx
		);

		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain(
			"a different file isn't supported"
		);
		expect(tasks.expand).not.toHaveBeenCalled();
	});
});

describe('expand_all', () => {
	const tool = () => register(registerExpandAllTool);
	const summary = {
		tag: 'master',
		expandedCount: 2,
		skippedCount: 1,
		failedCount: 0,
		tasksToExpand: 3,
		alreadyExpandedCount: 0,
		telemetryData: { commandName: 'expand-all-tasks', totalTokens: 9 }
	};

	it('hands tm-core the options and replies with the counts and summed usage', async () => {
		tasks.expandAll.mockImplementation(async (_options, hooks) => {
			hooks.onStart(['1', '2', '3']);
			hooks.onTaskDone('1', { skipped: undefined });
			hooks.onTaskDone('2', new Error('AI down'));
			return summary;
		});

		const result = await tool().execute(
			{ num: '3', research: true, force: true, projectRoot: project },
			ctx
		);

		expect(tool().name).toBe('expand_all');
		expect(tasks.expandAll).toHaveBeenCalledWith(
			{
				num: '3',
				research: true,
				prompt: undefined,
				force: true,
				tag: 'master',
				session: ctx.session,
				outputType: 'mcp'
			},
			expect.any(Object)
		);
		expect(reply(result).data).toEqual({
			message:
				'Expand all operation completed. Expanded: 2, Failed: 0, Skipped: 1',
			details: {
				expandedCount: 2,
				failedCount: 0,
				skippedCount: 1,
				tasksToExpand: 3
			},
			telemetryData: summary.telemetryData
		});
		expect(ctx.log.info).toHaveBeenCalledWith(
			'Found 3 tasks eligible for expansion.'
		);
		expect(ctx.log.error).toHaveBeenCalledWith(
			"Couldn't expand task 2: AI down"
		);
	});

	it('replies with empty telemetry when no task was eligible, as before', async () => {
		tasks.expandAll.mockResolvedValue({
			...summary,
			expandedCount: 0,
			skippedCount: 0,
			tasksToExpand: 0,
			telemetryData: null
		});

		const result = await tool().execute({ projectRoot: project }, ctx);

		expect(reply(result).data.telemetryData).toEqual([]);
	});

	it('returns a tm-core failure as an error', async () => {
		tasks.expandAll.mockRejectedValue(new Error('Tag "x" not found'));

		const result = await tool().execute({ projectRoot: project }, ctx);

		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain('Error: Tag "x" not found');
	});
});
