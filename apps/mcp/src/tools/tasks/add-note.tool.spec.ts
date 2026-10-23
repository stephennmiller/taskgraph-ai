/**
 * @fileoverview Tests for the add_note MCP tool.
 * tm-core is faked at the createTmCore boundary; everything else is real.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TaskGraphError } from '@tm/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const tasks = { addNote: vi.fn() };

vi.mock('@tm/core', async (importOriginal) => ({
	...(await importOriginal<typeof import('@tm/core')>()),
	createTmCore: vi.fn(async () => ({ tasks }))
}));

import { registerAddNoteTool } from './add-note.tool.js';

type Tool = {
	name: string;
	execute: (args: Record<string, unknown>, ctx: unknown) => Promise<any>;
};

function register(): Tool {
	const registered: Tool[] = [];
	registerAddNoteTool({
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
	project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'note-')));
});

afterEach(() => {
	fs.rmSync(project, { recursive: true, force: true });
});

describe('add_note', () => {
	it('is registered as add_note', () => {
		expect(register().name).toBe('add_note');
	});

	it('passes the note to tm-core as written and reports where it went', async () => {
		tasks.addNote.mockResolvedValue({
			id: '3.2',
			title: 'Hash passwords',
			isSubtask: true,
			addedAt: '2026-10-23T14:02:11.000Z',
			text: 'Chose argon2'
		});

		const result = await register().execute(
			{ projectRoot: project, id: '3.2', text: 'Chose argon2\n', tag: 'auth' },
			ctx
		);

		expect(result.isError).toBeFalsy();
		expect(tasks.addNote).toHaveBeenCalledWith('3.2', 'Chose argon2\n', {
			tag: 'auth'
		});
		const text = result.content[0].text as string;
		expect(text).toContain('Added a note to subtask 3.2');
		expect(text).toContain('2026-10-23T14:02:11.000Z');
	});

	it('returns an unknown ID as an error result', async () => {
		tasks.addNote.mockRejectedValue(
			new TaskGraphError('Task 9 not found', 'TASK_NOT_FOUND')
		);

		const result = await register().execute(
			{ projectRoot: project, id: '9', text: 'x' },
			ctx
		);

		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain('Task 9 not found');
	});
});
