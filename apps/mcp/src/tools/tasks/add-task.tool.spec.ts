/**
 * @fileoverview Tests for the add_task MCP tool: the arguments it hands
 * tm-core and the reply shape the legacy tool had. tm-core is faked at the
 * createTmCore boundary; everything else is real.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const tasks = { add: vi.fn() };
const config = { getActiveTag: vi.fn(() => 'master') };

vi.mock('@tm/core', async (importOriginal) => ({
	...(await importOriginal<typeof import('@tm/core')>()),
	createTmCore: vi.fn(async () => ({ tasks, config }))
}));

import { registerAddTaskTool } from './add-task.tool.js';

type Tool = {
	name: string;
	parameters: { safeParse: (v: unknown) => { success: boolean } };
	execute: (args: Record<string, unknown>, ctx: unknown) => Promise<any>;
};

function register(): Tool {
	const registered: Tool[] = [];
	registerAddTaskTool({
		addTool: (tool: Tool) => registered.push(tool)
	} as any);
	return registered[0];
}

const ctx = {
	log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
	session: { env: { KEY: 'v' } }
};

let project: string;

beforeEach(() => {
	vi.clearAllMocks();
	vi.stubEnv('TASKGRAPH_PROJECT_ROOT', '');
	project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'add-')));
	tasks.add.mockResolvedValue({
		task: { id: '5', title: 'Add login' },
		tag: 'master',
		dependencies: [],
		telemetryData: { totalTokens: 3 },
		tagInfo: { currentTag: 'master', availableTags: ['master'] }
	});
});

afterEach(() => {
	vi.unstubAllEnvs();
	fs.rmSync(project, { recursive: true, force: true });
});

const reply = (result: any) => JSON.parse(result.content[0].text);

describe('add_task', () => {
	it('is registered as add_task and takes a prompt and project root', () => {
		const tool = register();

		expect(tool.name).toBe('add_task');
		expect(
			tool.parameters.safeParse({ prompt: 'Add login', projectRoot: project })
				.success
		).toBe(true);
	});

	it('hands tm-core the parsed arguments and replies with a numeric task ID', async () => {
		const result = await register().execute(
			{
				prompt: 'Add login',
				dependencies: '1, 3.2,',
				priority: 'high',
				research: true,
				acceptanceCriteria: ['Logs in'],
				discoveredFrom: '2',
				projectRoot: project
			},
			ctx
		);

		expect(tasks.add).toHaveBeenCalledWith(
			expect.objectContaining({
				prompt: 'Add login',
				dependencies: ['1', '3.2'],
				priority: 'high',
				research: true,
				acceptanceCriteria: ['Logs in'],
				discoveredFrom: '2',
				tag: 'master',
				session: ctx.session,
				outputType: 'mcp'
			}),
			expect.any(Object)
		);
		expect(reply(result)).toMatchObject({
			data: {
				taskId: 5,
				message: 'Successfully added new task #5',
				telemetryData: { totalTokens: 3 },
				tagInfo: { currentTag: 'master', availableTags: ['master'] }
			},
			tag: 'master'
		});
	});

	it("lists tm-core's warnings in the reply, and leaves them out when there are none (#563)", async () => {
		const tool = register();
		const quiet = reply(
			await tool.execute({ prompt: 'p', projectRoot: project }, ctx)
		);
		tasks.add.mockImplementationOnce(async (_request, { onWarning }) => {
			onWarning(
				"Task 9 doesn't exist; adding the task without that dependency"
			);
			return { task: { id: '5' }, tag: 'master', dependencies: [] };
		});

		const result = await tool.execute(
			{ prompt: 'p', dependencies: '1,9', projectRoot: project },
			ctx
		);

		expect(quiet.data).not.toHaveProperty('warnings');
		expect(reply(result).data.warnings).toEqual([
			"Task 9 doesn't exist; adding the task without that dependency"
		]);
	});

	it('uses the manual fields over a prompt, without research', async () => {
		await register().execute(
			{
				prompt: 'ignored',
				title: 'T',
				description: 'D',
				research: true,
				tag: 'feature',
				projectRoot: project
			},
			ctx
		);

		expect(tasks.add).toHaveBeenCalledWith(
			expect.objectContaining({
				prompt: undefined,
				title: 'T',
				research: false,
				tag: 'feature'
			}),
			expect.any(Object)
		);
	});

	it('returns a tm-core failure as an error with the tag', async () => {
		tasks.add.mockRejectedValue(new Error("Task 42 doesn't exist"));

		const result = await register().execute(
			{ prompt: 'p', projectRoot: project },
			ctx
		);

		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("Error: Task 42 doesn't exist");
		expect(result.content[0].text).toContain('Current Tag: master');
	});

	it("adds tm-core's hint to the error", async () => {
		tasks.add.mockRejectedValue(
			Object.assign(new Error("Task 42 doesn't exist"), {
				hint: 'Run `taskgraph list` to see task IDs'
			})
		);

		const result = await register().execute(
			{ prompt: 'p', discoveredFrom: '42', projectRoot: project },
			ctx
		);

		expect(result.content[0].text).toContain(
			"Error: Task 42 doesn't exist. Run `taskgraph list` to see task IDs"
		);
	});

	it('refuses a tasks file other than the project tasks.json', async () => {
		const outside = await register().execute(
			{ prompt: 'p', file: '/etc/passwd', projectRoot: project },
			ctx
		);
		const other = await register().execute(
			{ prompt: 'p', file: 'other.json', projectRoot: project },
			ctx
		);
		const same = await register().execute(
			{
				prompt: 'p',
				file: '.taskgraph/tasks/tasks.json',
				projectRoot: project
			},
			ctx
		);

		expect(outside.isError).toBe(true);
		expect(outside.content[0].text).toContain(
			'add_task writes only .taskgraph/tasks/tasks.json, not /etc/passwd'
		);
		expect(other.isError).toBe(true);
		expect(same.isError).toBeFalsy();
		expect(tasks.add).toHaveBeenCalledTimes(1);
	});

	it('refuses a tag that is not a safe name before calling tm-core', async () => {
		const result = await register().execute(
			{ prompt: 'p', tag: '../x', projectRoot: project },
			ctx
		);

		expect(result.isError).toBe(true);
		expect(tasks.add).not.toHaveBeenCalled();
	});
});
