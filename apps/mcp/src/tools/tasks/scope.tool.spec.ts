/**
 * @fileoverview Tests for the scope_up_task and scope_down_task MCP tools:
 * the arguments they hand tm-core, the legacy reply shape, warnings in the
 * reply, and the refused tasks file. tm-core is faked at createTmCore.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const tasks = { scope: vi.fn() };
const config = { getActiveTag: vi.fn(() => 'master') };

vi.mock('@tm/core', async (importOriginal) => ({
	...(await importOriginal<typeof import('@tm/core')>()),
	createTmCore: vi.fn(async () => ({ tasks, config }))
}));

import { registerScopeDownTool, registerScopeUpTool } from './scope.tool.js';

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

let project: string;

beforeEach(() => {
	vi.clearAllMocks();
	vi.stubEnv('TASKGRAPH_PROJECT_ROOT', '');
	project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'scope-')));
	tasks.scope.mockImplementation(async (_input, hooks) => {
		hooks.onWarning('Failed to regenerate subtasks for task 3: boom');
		return {
			tag: 'master',
			tasks: [
				{
					task: { id: '3', title: 'Bigger' },
					regenerated: false,
					preserved: 0,
					generated: 0,
					complexity: { before: 5, after: 7 }
				}
			],
			telemetryData: { totalTokens: 9 }
		};
	});
});

afterEach(() => {
	vi.unstubAllEnvs();
	fs.rmSync(project, { recursive: true, force: true });
});

describe('scope_up_task / scope_down_task', () => {
	it('hands tm-core the arguments and replies as the legacy tool did', async () => {
		const tool = register(registerScopeUpTool);

		const result = await tool.execute(
			{
				id: '3',
				strength: 'heavy',
				prompt: 'Security',
				research: true,
				projectRoot: project
			},
			ctx
		);

		expect(tool.name).toBe('scope_up_task');
		expect(tasks.scope).toHaveBeenCalledWith(
			{
				ids: '3',
				direction: 'up',
				strength: 'heavy',
				prompt: 'Security',
				research: true,
				tag: 'master',
				session: ctx.session,
				outputType: 'mcp'
			},
			expect.any(Object)
		);
		expect(reply(result).data).toEqual({
			updatedTasks: [{ id: 3, title: 'Bigger' }],
			tasksUpdated: 1,
			message: 'Successfully scoped up 1 task(s)',
			telemetryData: { totalTokens: 9 },
			warnings: ['Failed to regenerate subtasks for task 3: boom']
		});
		expect(ctx.log.info).toHaveBeenCalledWith(
			'Task 3 complexity: 5/10 → 7/10 (+2)'
		);
	});

	it('replies with the error tm-core threw', async () => {
		tasks.scope.mockRejectedValue(new Error('Invalid strength level: max'));
		const tool = register(registerScopeDownTool);

		const result = await tool.execute(
			{ id: '3', strength: 'max', projectRoot: project },
			ctx
		);

		expect(tool.name).toBe('scope_down_task');
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain('Invalid strength level: max');
	});

	it('adds warnings from tasks saved before a failure to the error reply', async () => {
		tasks.scope.mockImplementation(async (_input, hooks) => {
			hooks.onWarning('Failed to regenerate subtasks for task 1: boom');
			throw new Error('overloaded (task 1 already scoped up)');
		});
		const tool = register(registerScopeUpTool);

		const result = await tool.execute({ id: '1,2', projectRoot: project }, ctx);

		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain(
			'overloaded (task 1 already scoped up). Warnings: Failed to regenerate subtasks for task 1: boom'
		);
	});

	it('refuses a tasks file other than the project one, before any AI call', async () => {
		const tool = register(registerScopeUpTool);

		const result = await tool.execute(
			{ id: '3', file: 'other/tasks.json', projectRoot: project },
			ctx
		);

		expect(result.isError).toBe(true);
		expect(tasks.scope).not.toHaveBeenCalled();
	});
});
