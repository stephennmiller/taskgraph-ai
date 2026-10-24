import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CURRENT_SCHEMA_VERSION } from '../storage/adapters/file-storage/schema-version.js';
import { initializeProject, planInit } from './init.service.js';
import { ALIAS_LINE } from './shell-aliases.js';

const git = (cwd: string, ...args: string[]) =>
	execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();

describe('initializeProject', () => {
	let projectDir: string;
	let homeDir: string;
	const saved = { HOME: process.env.HOME, SHELL: process.env.SHELL };
	const read = (file: string) =>
		fs.readFileSync(path.join(projectDir, file), 'utf8');
	const exists = (file: string) => fs.existsSync(path.join(projectDir, file));
	const write = (file: string, text: string) => {
		fs.mkdirSync(path.dirname(path.join(projectDir, file)), {
			recursive: true
		});
		fs.writeFileSync(path.join(projectDir, file), text);
	};

	beforeEach(() => {
		homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-home-'));
		projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-init-'));
		process.env.HOME = homeDir;
		process.env.SHELL = '/bin/zsh';
	});

	afterEach(() => {
		process.env.HOME = saved.HOME;
		process.env.SHELL = saved.SHELL;
		fs.rmSync(projectDir, { recursive: true, force: true });
		fs.rmSync(homeDir, { recursive: true, force: true });
	});

	it('sets up a new project', () => {
		const result = initializeProject({
			projectRoot: projectDir,
			claudeCode: true,
			responseLanguage: 'English'
		});

		for (const dir of ['tasks', 'docs', 'reports', 'templates']) {
			expect(exists(`.taskgraph/${dir}`)).toBe(true);
		}
		const state = JSON.parse(read('.taskgraph/state.json'));
		expect(state).toMatchObject({
			currentTag: 'master',
			branchTagMapping: {},
			migrationNoticeShown: true
		});
		const tasks = JSON.parse(read('.taskgraph/tasks/tasks.json'));
		expect(tasks.master.tasks).toEqual([]);
		expect(tasks.master.metadata.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
		const config = JSON.parse(read('.taskgraph/config.json'));
		expect(config.storage).toEqual({ type: 'file', operatingMode: 'solo' });
		expect(config.global.responseLanguage).toBe('English');
		expect(exists('.taskgraph/templates/example_prd.txt')).toBe(true);
		expect(exists('.taskgraph/templates/example_prd_rpg.txt')).toBe(true);
		expect(exists('.env.example')).toBe(true);
		expect(read('.gitignore')).toContain('# Task files\n# tasks.json\n');
		expect(read('CLAUDE.md')).toContain('@./.taskgraph/CLAUDE.md');
		expect(exists('.mcp.json')).toBe(false);
		// A new repository with the tasks.json merge driver
		expect(git(projectDir, 'rev-parse', '--is-inside-work-tree')).toBe('true');
		expect(read('.gitattributes')).toContain('merge=taskgraph');

		expect(result.alreadySetUp).toBe(false);
		expect(result.changes.map((change) => change.path)).toEqual([
			'.taskgraph/',
			'.git/',
			'.gitignore',
			'.gitattributes',
			'.env.example',
			'CLAUDE.md'
		]);
		expect(result.problems).toEqual([]);
		expect(result.imported).toBeUndefined();
	});

	it('keeps what the user has on a second run and reports no changes', () => {
		initializeProject({ projectRoot: projectDir, claudeCode: true });
		write('.env.example', 'MINE=1\n');
		write('.taskgraph/templates/example_prd.txt', 'my template');
		write('.taskgraph/tasks/tasks.json', '{"master":{"tasks":[{"id":"1"}]}}');
		const before = {
			gitignore: read('.gitignore'),
			claude: read('CLAUDE.md'),
			state: read('.taskgraph/state.json')
		};

		const result = initializeProject({
			projectRoot: projectDir,
			claudeCode: true
		});

		expect(read('.env.example')).toBe('MINE=1\n');
		expect(read('.taskgraph/templates/example_prd.txt')).toBe('my template');
		expect(read('.taskgraph/tasks/tasks.json')).toBe(
			'{"master":{"tasks":[{"id":"1"}]}}'
		);
		expect(read('.gitignore')).toBe(before.gitignore);
		expect(read('CLAUDE.md')).toBe(before.claude);
		expect(read('.taskgraph/state.json')).toBe(before.state);
		expect(result.alreadySetUp).toBe(true);
		expect(result.changes).toEqual([]);
	});

	it('keeps the task storage choice an earlier init wrote', () => {
		initializeProject({
			projectRoot: projectDir,
			claudeCode: false,
			storeTasksInGit: false
		});
		initializeProject({ projectRoot: projectDir, claudeCode: false });

		expect(read('.gitignore')).toContain('# Task files\ntasks.json\n');
		expect(exists('.gitattributes')).toBe(false);
	});

	it('skips git init with initGit: false and Claude Code with claudeCode: false', () => {
		const result = initializeProject({
			projectRoot: projectDir,
			initGit: false,
			claudeCode: false
		});

		expect(exists('.git')).toBe(false);
		expect(exists('.gitattributes')).toBe(false);
		expect(exists('CLAUDE.md')).toBe(false);
		expect(result.problems).toEqual([]);
	});

	it('uses the repository the folder is already in', () => {
		git(projectDir, 'init', '-q');
		const sub = path.join(projectDir, 'app');
		fs.mkdirSync(sub);

		initializeProject({ projectRoot: sub, claudeCode: false });

		expect(fs.existsSync(path.join(sub, '.git'))).toBe(false);
		expect(fs.existsSync(path.join(sub, '.gitattributes'))).toBe(true);
	});

	it('adds the tm alias only when asked, once', () => {
		fs.writeFileSync(path.join(homeDir, '.zshrc'), '# mine\n');

		initializeProject({ projectRoot: projectDir, claudeCode: false });
		expect(fs.readFileSync(path.join(homeDir, '.zshrc'), 'utf8')).toBe(
			'# mine\n'
		);

		const result = initializeProject({
			projectRoot: projectDir,
			claudeCode: false,
			aliases: true
		});
		initializeProject({
			projectRoot: projectDir,
			claudeCode: false,
			aliases: true
		});

		const rc = fs.readFileSync(path.join(homeDir, '.zshrc'), 'utf8');
		expect(rc.split(ALIAS_LINE)).toHaveLength(2);
		expect(result.changes).toEqual([
			{ path: '~/.zshrc', note: 'added the `tm` alias; open a new terminal' }
		]);
	});

	it('warns and writes nothing for aliases when the shell or its file is unknown', () => {
		process.env.SHELL = '/bin/fish';
		const fish = initializeProject({
			projectRoot: projectDir,
			claudeCode: false,
			aliases: true
		});
		process.env.SHELL = '/bin/zsh';
		const zsh = initializeProject({
			projectRoot: projectDir,
			claudeCode: false,
			aliases: true
		});

		expect(fs.readdirSync(homeDir)).toEqual([]);
		expect(fish.problems).toEqual([
			{
				level: 'warn',
				message: "Couldn't add the tm alias: the shell is not zsh or bash"
			}
		]);
		expect(zsh.problems).toEqual([
			{
				level: 'warn',
				message: `Couldn't add the tm alias: ${path.join(homeDir, '.zshrc')} not found`
			}
		]);
	});

	it('moves per-machine settings from config.json to config.local.json', () => {
		initializeProject({ projectRoot: projectDir, claudeCode: false });
		const config = JSON.parse(read('.taskgraph/config.json'));
		config.claudeCode = { pathToClaudeCodeExecutable: '/opt/claude' };
		write('.taskgraph/config.json', JSON.stringify(config));

		const result = initializeProject({
			projectRoot: projectDir,
			claudeCode: false
		});

		expect(JSON.parse(read('.taskgraph/config.local.json'))).toMatchObject({
			claudeCode: { pathToClaudeCodeExecutable: '/opt/claude' }
		});
		expect(result.changes[0]).toEqual({
			path: '.taskgraph/config.local.json',
			note: "this machine's settings, moved from config.json"
		});
	});

	it('hints at a state.json Git still tracks', () => {
		initializeProject({ projectRoot: projectDir, claudeCode: false });
		git(projectDir, 'add', '-f', '.taskgraph/state.json');

		const result = initializeProject({
			projectRoot: projectDir,
			claudeCode: false
		});

		expect(result.hints).toEqual([
			{
				path: '.taskgraph/state.json',
				note: 'ignored but still tracked; `git rm --cached` it'
			}
		]);
	});

	it('reports a step that failed and carries on', () => {
		write('.taskgraph/config.json', '{ not json');

		const result = initializeProject({
			projectRoot: projectDir,
			claudeCode: false,
			responseLanguage: 'English'
		});

		expect(read('.taskgraph/config.json')).toBe('{ not json');
		expect(result.problems.map((problem) => problem.level)).toContain('error');
		expect(
			result.problems.some((problem) =>
				problem.message.startsWith('Failed to set response language')
			)
		).toBe(true);
		expect(exists('.gitignore')).toBe(true);
	});

	it('hands each problem to onProblem before a later step throws', () => {
		write('.taskgraph/config.json', '{ not json');
		const seen: string[] = [];

		// No upstream folder: the import throws after the config steps failed
		expect(() =>
			initializeProject({
				projectRoot: projectDir,
				claudeCode: false,
				importUpstream: true,
				onProblem: (problem) => seen.push(problem.message)
			})
		).toThrow();

		expect(
			seen.some((message) => message.startsWith('Error updating config'))
		).toBe(true);
	});
});

describe('planInit', () => {
	let projectDir: string;

	beforeEach(() => {
		projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-plan-'));
	});

	afterEach(() => {
		fs.rmSync(projectDir, { recursive: true, force: true });
	});

	it('starts Git and the merge driver outside a repository', () => {
		expect(
			planInit(projectDir, {
				initGit: true,
				storeTasksInGit: true,
				aliases: false
			})
		).toEqual({ startGit: true, mergeDriver: true, aliasFile: null });
		expect(
			planInit(projectDir, {
				initGit: false,
				storeTasksInGit: true,
				aliases: false
			})
		).toEqual({ startGit: false, mergeDriver: false, aliasFile: null });
		expect(fs.readdirSync(projectDir)).toEqual([]);
	});

	it('uses an existing repository even with initGit: false', () => {
		git(projectDir, 'init', '-q');

		expect(
			planInit(projectDir, {
				initGit: false,
				storeTasksInGit: true,
				aliases: false
			})
		).toEqual({ startGit: false, mergeDriver: true, aliasFile: null });
	});
});
