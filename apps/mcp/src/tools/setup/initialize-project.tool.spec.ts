/**
 * @fileoverview initialize_project MCP tool against real tm-core in a temp
 * project (an isolated HOME, no git init)
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerInitializeProjectTool } from './initialize-project.tool.js';

type Tool = {
	name: string;
	parameters: { safeParse: (value: unknown) => { success: boolean } };
	execute: (args: Record<string, unknown>, ctx: unknown) => Promise<any>;
};

function register(): Tool {
	const registered: Tool[] = [];
	registerInitializeProjectTool({
		addTool: (tool: Tool) => registered.push(tool)
	} as never);
	return registered[0];
}

describe('initialize_project', () => {
	const tool = register();
	let projectRoot: string;
	let home: string;
	const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
	const run = (args: Record<string, unknown>, session: unknown = {}) =>
		tool.execute({ initGit: false, ...args }, { log, session });

	beforeEach(() => {
		vi.stubEnv('TASKGRAPH_PROJECT_ROOT', '');
		home = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-mcp-home-'));
		vi.stubEnv('HOME', home);
		projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-mcp-init-'));
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		fs.rmSync(projectRoot, { recursive: true, force: true });
		fs.rmSync(home, { recursive: true, force: true });
	});

	it('accepts only known rule profiles', () => {
		expect(tool.name).toBe('initialize_project');
		expect(
			tool.parameters.safeParse({ projectRoot, rules: ['claude'] }).success
		).toBe(true);
		expect(
			tool.parameters.safeParse({ projectRoot, rules: ['cursor'] }).success
		).toBe(false);
	});

	it('sets up the project with Claude Code and replies with the next step', async () => {
		const response = await run({ projectRoot: `file://${projectRoot}` });

		const reply = JSON.parse(response.content[0].text);
		expect(reply.data.message).toBe('Project initialized successfully.');
		expect(reply.data.next_step).toMatch(
			/^Now that the project is initialized/
		);
		expect(reply.tag).toBe('master');
		expect(
			fs.readFileSync(path.join(projectRoot, 'CLAUDE.md'), 'utf8')
		).toContain('@./.taskgraph/CLAUDE.md');
		expect(
			JSON.parse(
				fs.readFileSync(
					path.join(projectRoot, '.taskgraph/config.json'),
					'utf8'
				)
			).global.responseLanguage
		).toBe('English');
		expect(fs.existsSync(path.join(projectRoot, '.mcp.json'))).toBe(false);
		expect(fs.readdirSync(home)).toEqual([]);
	});

	it('takes the project root from the session when none is passed', async () => {
		await run({}, { roots: [{ uri: `file://${projectRoot}` }] });

		expect(
			fs.existsSync(path.join(projectRoot, '.taskgraph/config.json'))
		).toBe(true);
	});

	it('refuses the home folder', async () => {
		const response = await run({ projectRoot: home });

		expect(response.isError).toBe(true);
		expect(response.content[0].text).toContain(
			`Error: Cannot initialize project: Invalid target directory '${home}'`
		);
		expect(fs.readdirSync(home)).toEqual([]);
	});

	it('replies with an error when initialization fails', async () => {
		const file = path.join(projectRoot, 'not-a-dir');
		fs.writeFileSync(file, '');

		const response = await run({ projectRoot: file });

		expect(response.isError).toBe(true);
		expect(response.content[0].text).toContain(
			'Error: Core project initialization failed:'
		);
		expect(log.error).toHaveBeenCalledWith(
			expect.stringMatching(/^Initialization failed: Core project/)
		);
	});
});
