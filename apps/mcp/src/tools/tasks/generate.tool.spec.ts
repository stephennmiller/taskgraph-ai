/**
 * @fileoverview Tests for the generate MCP tool.
 * tm-core is faked at the createTmCore boundary; everything else is real.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const tasks = {
	generateTaskFiles: vi.fn()
};

vi.mock('@tm/core', async (importOriginal) => ({
	...(await importOriginal<typeof import('@tm/core')>()),
	createTmCore: vi.fn(async () => ({ tasks }))
}));

import { registerGenerateTool } from './generate.tool.js';

type Tool = {
	execute: (args: Record<string, unknown>, ctx: unknown) => Promise<any>;
};

function register(): Tool {
	const registered: Tool[] = [];
	registerGenerateTool({
		addTool: (tool: Tool) => registered.push(tool)
	} as any);
	return registered[0];
}

const ctx = {
	log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
	session: undefined
};

const tmp = () =>
	fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gen-')));

let project: string;
let outside: string;

beforeEach(() => {
	vi.clearAllMocks();
	tasks.generateTaskFiles.mockResolvedValue({
		success: true,
		count: 1,
		directory: 'x',
		orphanedFilesRemoved: 0
	});
	project = tmp();
	outside = tmp();
});

afterEach(() => {
	fs.rmSync(project, { recursive: true, force: true });
	fs.rmSync(outside, { recursive: true, force: true });
});

describe('generate output directory', () => {
	it.each([
		['an absolute path elsewhere', () => outside],
		['a relative path that climbs out', () => path.relative(project, outside)],
		['a home-relative path', () => '~/tasks']
	])('refuses %s and writes nothing', async (_name, output) => {
		const result = await register().execute(
			{ projectRoot: project, output: output() },
			ctx
		);

		expect(result.isError).toBe(true);
		expect(tasks.generateTaskFiles).not.toHaveBeenCalled();
	});

	it('refuses a directory inside the project that is a symlink out of it', async () => {
		fs.symlinkSync(outside, path.join(project, 'link'));

		const result = await register().execute(
			{ projectRoot: project, output: 'link/tasks' },
			ctx
		);

		expect(result.isError).toBe(true);
		expect(tasks.generateTaskFiles).not.toHaveBeenCalled();
	});

	it('passes a directory inside the project to tm-core as an absolute path', async () => {
		await register().execute(
			{ projectRoot: project, output: 'out/tasks' },
			ctx
		);

		expect(tasks.generateTaskFiles).toHaveBeenCalledWith({
			tag: undefined,
			outputDir: path.join(project, 'out', 'tasks')
		});
	});

	it('leaves the default directory to tm-core when no output is given', async () => {
		await register().execute({ projectRoot: project }, ctx);

		expect(tasks.generateTaskFiles).toHaveBeenCalledWith({
			tag: undefined,
			outputDir: undefined
		});
	});
});
