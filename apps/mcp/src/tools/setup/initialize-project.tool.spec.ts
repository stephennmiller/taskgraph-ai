/**
 * @fileoverview initialize_project MCP tool against real tm-core in a temp
 * project (an isolated HOME, no git init)
 */

import { execFileSync } from 'node:child_process';
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

	it('keeps the response language on a re-run', async () => {
		await run({ projectRoot });
		const configPath = path.join(projectRoot, '.taskgraph/config.json');
		const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
		config.global.responseLanguage = 'Español';
		fs.writeFileSync(configPath, JSON.stringify(config));

		await run({ projectRoot });

		expect(
			JSON.parse(fs.readFileSync(configPath, 'utf8')).global.responseLanguage
		).toBe('Español');
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

	it('lists the steps that failed and says so', async () => {
		fs.mkdirSync(path.join(projectRoot, '.gitignore'));

		const response = await run({ projectRoot });

		const reply = JSON.parse(response.content[0].text);
		expect(reply.data.message).toBe(
			'Project initialized, but some steps failed: see warnings.'
		);
		expect(reply.data.warnings).toContainEqual(
			expect.stringMatching(/^Failed to create \.gitignore/)
		);
		expect(log.error).toHaveBeenCalledWith(
			expect.stringMatching(/^Failed to create \.gitignore/)
		);
	});

	it('points the merge driver at the CLI beside the server, not the server', async () => {
		// shortcut: only git on PATH, so `taskgraph` is not found and the
		// driver names a script
		const gitDir = path.dirname(
			execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim()
		);
		vi.stubEnv('PATH', gitDir);
		const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-mcp-dist-'));
		const server = path.join(dist, 'mcp-server.js');
		fs.writeFileSync(server, '');
		const argv1 = process.argv[1];
		process.argv[1] = server;
		try {
			await run({ projectRoot, initGit: true });
		} finally {
			process.argv[1] = argv1;
		}

		const driver = execFileSync(
			'git',
			['config', '--get', 'merge.taskgraph.driver'],
			{ cwd: projectRoot, encoding: 'utf8' }
		);
		const cli = path.join(fs.realpathSync(dist), 'taskgraph.js');
		fs.rmSync(dist, { recursive: true, force: true });
		expect(driver).toContain(cli);
		expect(driver).not.toContain('mcp-server.js');
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
