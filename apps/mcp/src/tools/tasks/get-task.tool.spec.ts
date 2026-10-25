/**
 * @fileoverview Tests for the get_task MCP tool.
 * tm-core is faked at the createTmCore boundary; everything else is real.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const tasks = { get: vi.fn(), getPrdSection: vi.fn() };
const config = { getActiveTag: vi.fn(() => 'master') };

vi.mock('@tm/core', async (importOriginal) => ({
	...(await importOriginal<typeof import('@tm/core')>()),
	createTmCore: vi.fn(async () => ({ tasks, config }))
}));

import { registerGetTaskTool } from './get-task.tool.js';

type Tool = {
	execute: (args: Record<string, unknown>, ctx: unknown) => Promise<any>;
};

function register(): Tool {
	const registered: Tool[] = [];
	registerGetTaskTool({
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
const section = { source: 'docs/prd.md#sessions', text: '## Sessions\n\nBody' };

beforeEach(() => {
	vi.clearAllMocks();
	tasks.get.mockImplementation(async (id: string) => ({
		task: { id, title: `Task ${id}` },
		isSubtask: id.includes('.')
	}));
});

describe('get_task', () => {
	it('includes the PRD section the task cites, as show prints it', async () => {
		tasks.getPrdSection.mockResolvedValue(section);

		const result = reply(
			await register().execute({ id: '2.1', projectRoot, tag: 'feat' }, ctx)
		);

		expect(tasks.getPrdSection).toHaveBeenCalledWith('2.1', 'feat');
		expect(result.data).toEqual({
			id: '2.1',
			title: 'Task 2.1',
			prdSection: section
		});
	});

	it('leaves prdSection out for a task that cites none', async () => {
		tasks.getPrdSection.mockImplementation(async (id: string) =>
			id === '1' ? section : undefined
		);

		const result = reply(
			await register().execute({ id: '1,2', projectRoot }, ctx)
		);

		expect(result.data).toEqual([
			{ id: '1', title: 'Task 1', prdSection: section },
			{ id: '2', title: 'Task 2' }
		]);
	});
});
