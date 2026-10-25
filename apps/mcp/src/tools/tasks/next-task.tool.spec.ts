/**
 * @fileoverview Tests for the next_task MCP tool.
 * tm-core is faked at the createTmCore boundary; everything else is real.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const tasks = {
	getNext: vi.fn(),
	claimNext: vi.fn(),
	getComplexityReport: vi.fn(),
	requireTasksFile: vi.fn()
};
const config = { getActiveTag: vi.fn(() => 'master') };

vi.mock('@tm/core', async (importOriginal) => ({
	...(await importOriginal<typeof import('@tm/core')>()),
	createTmCore: vi.fn(async () => ({ tasks, config }))
}));

import { registerNextTaskTool } from './next-task.tool.js';

type Tool = {
	name: string;
	execute: (args: Record<string, unknown>, ctx: unknown) => Promise<any>;
};

function register(): Tool {
	const registered: Tool[] = [];
	registerNextTaskTool({
		addTool: (tool: Tool) => registered.push(tool)
	} as any);
	return registered[0];
}

const ctx = {
	log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
	session: undefined
};

const projectRoot = process.cwd();
const reply = (result: any) => JSON.parse(result.content[0].text);

const report = (taskId: number, complexityScore: number) => ({
	report: { complexityAnalysis: [{ taskId, complexityScore }] },
	reportPath: 'report.json'
});

beforeEach(() => {
	vi.clearAllMocks();
	tasks.getComplexityReport.mockReturnValue(null);
});

describe('next_task', () => {
	it('replies with the next task, its score and the current tag', async () => {
		tasks.getNext.mockResolvedValue({ id: '2', title: 'Parser' });
		tasks.getComplexityReport.mockReturnValue(report(2, 6));

		const result = reply(await register().execute({ projectRoot }, ctx));

		expect(tasks.getNext).toHaveBeenCalledWith('master');
		expect(result.tag).toBe('master');
		expect(result.data).toEqual({
			nextTask: { id: 2, title: 'Parser', complexityScore: 6 },
			isSubtask: false,
			nextSteps: 'Start it with set_task_status id "2" status "in-progress"'
		});
	});

	it("gives a subtask the legacy fields and its task's score", async () => {
		tasks.getNext.mockResolvedValue({
			id: '2.1',
			title: 'Read',
			status: 'pending',
			priority: 'high',
			dependencies: ['1'],
			details: 'Not in the reply',
			subtasks: [],
			parentId: '2'
		});
		tasks.getComplexityReport.mockReturnValue(report(2, 9));

		const result = reply(
			await register().execute({ projectRoot, tag: 'feature' }, ctx)
		);

		expect(tasks.getComplexityReport).toHaveBeenCalledWith({ tag: 'feature' });
		expect(result.tag).toBe('feature');
		expect(result.data.isSubtask).toBe(true);
		expect(result.data.nextTask).toEqual({
			id: '2.1',
			title: 'Read',
			status: 'pending',
			priority: 'high',
			dependencies: ['1'],
			parentId: 2,
			complexityScore: 9
		});
		expect(result.data.nextSteps).toBe(
			'Start it with set_task_status id "2.1" status "in-progress"'
		);
	});

	it('leaves the score out when the report is unreadable', async () => {
		tasks.getNext.mockResolvedValue({ id: '2', title: 'Parser' });
		tasks.getComplexityReport.mockImplementation(() => {
			throw new Error('bad JSON');
		});

		const result = reply(await register().execute({ projectRoot }, ctx));

		expect(result.data.nextTask).toEqual({ id: 2, title: 'Parser' });
		expect(ctx.log.warn).toHaveBeenCalledWith(
			expect.stringContaining('bad JSON')
		);
	});

	it('stays quiet when the default report does not exist', async () => {
		tasks.getNext.mockResolvedValue({ id: '2', title: 'Parser' });

		await register().execute({ projectRoot }, ctx);

		expect(ctx.log.warn).not.toHaveBeenCalled();
	});

	it('says so when no task is eligible', async () => {
		tasks.getNext.mockResolvedValue(null);

		const result = reply(await register().execute({ projectRoot }, ctx));

		expect(result.data).toEqual({
			message:
				'No eligible next task found. All tasks are either completed or have unsatisfied dependencies',
			nextTask: null
		});
	});

	it('fails when the project has no tasks file', async () => {
		tasks.requireTasksFile.mockImplementationOnce(() => {
			throw new Error('No tasks file at /p/.taskgraph/tasks/tasks.json');
		});

		const result = await register().execute({ projectRoot }, ctx);

		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain('No tasks file at');
		expect(tasks.getNext).not.toHaveBeenCalled();
	});

	it('takes no legacy file or complexityReport', () => {
		const { parameters } = register() as unknown as {
			parameters: { shape: Record<string, unknown> };
		};

		expect(Object.keys(parameters.shape)).toEqual([
			'projectRoot',
			'tag',
			'claim'
		]);
	});

	it('claims the task with claim: true', async () => {
		tasks.claimNext.mockResolvedValue({
			task: { id: '3', title: 'Claimed' },
			claimedBy: 'me',
			claimedAt: '2026-01-01T00:00:00.000Z'
		});

		const result = reply(
			await register().execute({ projectRoot, claim: true }, ctx)
		);

		expect(tasks.claimNext).toHaveBeenCalledWith({ tag: 'master' });
		expect(result.data).toMatchObject({
			nextTask: { id: '3' },
			isSubtask: false,
			claimedBy: 'me'
		});
	});
});
