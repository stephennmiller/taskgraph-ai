/**
 * @fileoverview Tests for the get_tasks MCP tool's response shape and size.
 * tm-core is faked at the createTmCore boundary; everything else is real.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Task } from '@tm/core';
import { createSubtask, createTask } from '@tm/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const tasks = { list: vi.fn() };

vi.mock('@tm/core', async (importOriginal) => ({
	...(await importOriginal<typeof import('@tm/core')>()),
	createTmCore: vi.fn(async () => ({ tasks }))
}));

import { registerGetTasksTool } from './get-tasks.tool.js';

type Tool = {
	execute: (args: Record<string, unknown>, ctx: unknown) => Promise<any>;
};

function register(): Tool {
	const registered: Tool[] = [];
	registerGetTasksTool({
		addTool: (tool: Tool) => registered.push(tool)
	} as any);
	return registered[0];
}

const ctx = {
	log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
	session: undefined
};

/** About 4 characters per token, the usual estimate for JSON */
const tokens = (text: string): number => Math.ceil(text.length / 4);

const STATUSES = ['done', 'in-progress', 'pending', 'pending'] as const;

/** 40 tasks shaped like a parsed PRD: long details, tests, two subtasks */
const FIXTURE: Task[] = Array.from({ length: 40 }, (_, index) => {
	const id = index + 1;
	return createTask({
		id,
		title: `Implement feature ${id} with validation and error handling`,
		description: `Build feature ${id} end to end, from the storage layer to the CLI and MCP surfaces.`,
		status: STATUSES[index % STATUSES.length],
		priority: id % 3 === 0 ? 'high' : 'medium',
		dependencies: id > 1 ? [String(id - 1)] : [],
		details: `Add a service for feature ${id} in tm-core. `.repeat(16),
		testStrategy:
			`Unit tests for feature ${id}, then an integration test. `.repeat(5),
		subtasks: [1, 2].map((sub) =>
			createSubtask({
				id: sub,
				parentId: String(id),
				title: `Step ${sub} of feature ${id}`,
				details: `Write the code for step ${sub}. `.repeat(6)
			})
		)
	});
});

let project: string;

beforeEach(() => {
	vi.clearAllMocks();
	project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gts-')));
	tasks.list.mockResolvedValue({
		tasks: FIXTURE,
		total: FIXTURE.length,
		filtered: FIXTURE.length,
		tag: 'master'
	});
});

afterEach(() => {
	fs.rmSync(project, { recursive: true, force: true });
});

describe('get_tasks', () => {
	it('stays under 2k tokens on a 40-task project by default', async () => {
		const result = await register().execute({ projectRoot: project }, ctx);
		const text: string = result.content[0].text;

		const everything = await register().execute(
			{ projectRoot: project, fields: 'all' },
			ctx
		);
		expect(tokens(everything.content[0].text)).toBeGreaterThan(10_000);
		expect(tokens(text)).toBeLessThan(2_000);
	});

	it('returns minified JSON with the default fields', async () => {
		const result = await register().execute({ projectRoot: project }, ctx);
		const text: string = result.content[0].text;

		expect(text).not.toContain('\n');
		const { data } = JSON.parse(text);
		expect(data.tasks).toHaveLength(40);
		expect(data.tasks[1]).toEqual({
			id: '2',
			title: 'Implement feature 2 with validation and error handling',
			status: 'in-progress',
			priority: 'medium',
			dependencies: ['1']
		});
		expect(data).not.toHaveProperty('stats');
	});

	it('adds the fields asked for', async () => {
		const result = await register().execute(
			{ projectRoot: project, fields: 'title,testStrategy' },
			ctx
		);

		const { data } = JSON.parse(result.content[0].text);
		expect(Object.keys(data.tasks[0])).toEqual(['id', 'title', 'testStrategy']);
	});

	// #661: with its full dotted ID, as get_task and next_task give it
	it('nests subtasks with the same fields when asked', async () => {
		const result = await register().execute(
			{ projectRoot: project, withSubtasks: true },
			ctx
		);

		const { data } = JSON.parse(result.content[0].text);
		expect(data.tasks[0].subtasks[0]).toEqual({
			id: '1.1',
			title: 'Step 1 of feature 1',
			status: 'pending',
			priority: 'medium',
			dependencies: []
		});
	});

	it('passes the status filter to tm-core', async () => {
		await register().execute(
			{ projectRoot: project, status: 'pending, review' },
			ctx
		);

		expect(tasks.list).toHaveBeenCalledWith(
			expect.objectContaining({ filter: { status: ['pending', 'review'] } })
		);
	});

	it('refuses an unknown status, naming the valid ones', async () => {
		const result = await register().execute(
			{ projectRoot: project, status: 'bogus' },
			ctx
		);

		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain(
			'"bogus" isn\'t a status. Use one of: pending'
		);
		expect(tasks.list).not.toHaveBeenCalled();
	});

	it('names the valid fields when one is unknown', async () => {
		const result = await register().execute(
			{ projectRoot: project, fields: 'detials' },
			ctx
		);

		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain(
			'Unknown task field: detials. Valid fields: all, id, title'
		);
		expect(tasks.list).not.toHaveBeenCalled();
	});
});
