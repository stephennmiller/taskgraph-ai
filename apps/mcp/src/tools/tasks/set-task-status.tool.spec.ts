/**
 * @fileoverview Tests for the set_task_status MCP tool's criteria gate.
 * tm-core is faked at the createTmCore boundary; everything else is real.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkDoneGate } from '@tm/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const tasks = {
	updateStatus: vi.fn(),
	updateStatuses: vi.fn(),
	updateChecklist: vi.fn()
};

vi.mock('@tm/core', async (importOriginal) => ({
	...(await importOriginal<typeof import('@tm/core')>()),
	createTmCore: vi.fn(async () => ({ tasks }))
}));

import { registerSetTaskStatusTool } from './set-task-status.tool.js';

type Tool = {
	execute: (args: Record<string, unknown>, ctx: unknown) => Promise<any>;
};

function register(): Tool {
	const registered: Tool[] = [];
	registerSetTaskStatusTool({
		addTool: (tool: Tool) => registered.push(tool)
	} as any);
	return registered[0];
}

const ctx = {
	log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
	session: undefined
};

let project: string;

beforeEach(() => {
	vi.clearAllMocks();
	project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sts-')));
});

afterEach(() => {
	fs.rmSync(project, { recursive: true, force: true });
});

describe('set_task_status criteria gate', () => {
	it('returns the unchecked criteria and the fix as an error result', async () => {
		tasks.updateStatuses.mockRejectedValue(
			checkDoneGate({ acceptanceCriteria: ['Login works'] }, '3', [
				'Tests pass'
			])
		);

		const result = await register().execute(
			{ projectRoot: project, id: '3', status: 'done' },
			ctx
		);

		expect(result.isError).toBe(true);
		const text = result.content[0].text as string;
		expect(text).toContain('2 criteria unchecked on task 3:');
		expect(text).toContain('  1. Login works');
		expect(text).toContain('  2. Tests pass');
		expect(text).toContain(
			'Check them with check: [1, 2], or pass force: true'
		);
	});

	it('passes force through to tm-core', async () => {
		tasks.updateStatuses.mockResolvedValue([
			{
				success: true,
				taskId: '3',
				oldStatus: 'pending',
				newStatus: 'done'
			}
		]);

		const result = await register().execute(
			{ projectRoot: project, id: '3', status: 'done', force: true },
			ctx
		);

		expect(result.isError).toBeFalsy();
		expect(tasks.updateStatuses).toHaveBeenCalledWith(
			['3'],
			'done',
			undefined,
			{ force: true }
		);
		expect(tasks.updateStatus).not.toHaveBeenCalled();
	});

	it('checks criteria before setting the status', async () => {
		tasks.updateChecklist.mockResolvedValue({
			items: [],
			checkedCount: 0,
			unchecked: []
		});
		tasks.updateStatuses.mockResolvedValue([
			{
				success: true,
				taskId: '3',
				oldStatus: 'pending',
				newStatus: 'done'
			}
		]);

		await register().execute(
			{ projectRoot: project, id: '3', status: 'done', check: [1, 2] },
			ctx
		);

		expect(tasks.updateChecklist).toHaveBeenCalledWith(
			'3',
			{ check: [1, 2], uncheck: undefined },
			undefined
		);
		expect(tasks.updateChecklist.mock.invocationCallOrder[0]).toBeLessThan(
			tasks.updateStatuses.mock.invocationCallOrder[0]
		);
	});

	it('clears criteria with uncheck and no status', async () => {
		tasks.updateChecklist.mockResolvedValue({
			items: [],
			checkedCount: 0,
			unchecked: []
		});

		const result = await register().execute(
			{ projectRoot: project, id: '3', uncheck: [2] },
			ctx
		);

		expect(result.isError).toBeFalsy();
		expect(tasks.updateChecklist).toHaveBeenCalledWith(
			'3',
			{ check: undefined, uncheck: [2] },
			undefined
		);
		expect(tasks.updateStatus).not.toHaveBeenCalled();
		expect(tasks.updateStatuses).not.toHaveBeenCalled();
	});

	it('updates several ids in one call', async () => {
		tasks.updateStatuses.mockRejectedValue(new Error('Task 99 not found'));

		const result = await register().execute(
			{ projectRoot: project, id: '1,99', status: 'done' },
			ctx
		);

		expect(result.isError).toBe(true);
		expect(String(result.content[0].text)).toContain('Task 99 not found');
		expect(tasks.updateStatuses).toHaveBeenCalledTimes(1);
		expect(tasks.updateStatuses).toHaveBeenCalledWith(
			['1', '99'],
			'done',
			undefined,
			{ force: undefined }
		);
		expect(tasks.updateStatus).not.toHaveBeenCalled();
	});

	it('refuses check with several task IDs', async () => {
		const result = await register().execute(
			{ projectRoot: project, id: '3,4', check: [1] },
			ctx
		);

		expect(result.isError).toBe(true);
		expect(tasks.updateChecklist).not.toHaveBeenCalled();
	});
});
