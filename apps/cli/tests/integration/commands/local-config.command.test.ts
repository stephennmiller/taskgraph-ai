/**
 * @fileoverview Integration tests for per-machine files: `init` gitignores
 * .taskgraph/state.json and .taskgraph/config.local.json, config.local.json
 * overrides config.json, and per-machine settings an earlier release wrote
 * to config.json move to config.local.json. Runs the built CLI.
 *
 * @integration
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it
} from 'vitest';
import { getCliBinPath } from '../../helpers/test-utils.js';

const EXECUTABLE = '/opt/claude/bin/claude';

describe('per-machine config and state', () => {
	let dir: string;
	let home: string;

	const run = (args: string[]) =>
		spawnSync('node', [getCliBinPath(), ...args], {
			cwd: dir,
			encoding: 'utf8',
			env: {
				...process.env,
				HOME: home,
				FORCE_COLOR: '0',
				COLUMNS: '80',
				TASKGRAPH_SKIP_AUTO_UPDATE: '1'
			}
		});
	const git = (args: string[]) =>
		spawnSync('git', args, { cwd: dir, encoding: 'utf8' });

	const sharedPath = () => path.join(dir, '.taskgraph', 'config.json');
	const localPath = () => path.join(dir, '.taskgraph', 'config.local.json');
	const readJson = (file: string) => JSON.parse(fs.readFileSync(file, 'utf8'));
	const writeJson = (file: string, data: unknown) =>
		fs.writeFileSync(file, JSON.stringify(data, null, 2));
	const editShared = (edit: (config: any) => void) => {
		const config = readJson(sharedPath());
		edit(config);
		writeJson(sharedPath(), config);
	};

	// One init, copied into each test's folder: init is the slow part
	let template: string;

	beforeAll(() => {
		template = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-local-config-tpl-'));
		home = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-local-config-home-'));
		dir = template;
		run(['init', '--yes', '--no-aliases', '--no-git']);
	});

	afterAll(() => {
		fs.rmSync(template, { recursive: true, force: true });
		fs.rmSync(home, { recursive: true, force: true });
	});

	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-local-config-'));
		fs.cpSync(template, dir, { recursive: true });
	});

	afterEach(() => {
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it('gitignores state.json and config.local.json', () => {
		const lines = fs
			.readFileSync(path.join(dir, '.gitignore'), 'utf8')
			.split('\n');

		expect(lines).toContain('.taskgraph/state.json');
		expect(lines).toContain('.taskgraph/config.local.json');
		expect(fs.existsSync(localPath())).toBe(false);
	});

	it('adds them once to a .gitignore from an earlier init', () => {
		const gitignore = path.join(dir, '.gitignore');
		fs.writeFileSync(
			gitignore,
			'node_modules/\n\n# Task files\n# tasks.json\n'
		);

		run(['init', '--yes', '--no-aliases', '--no-git']);

		const lines = fs.readFileSync(gitignore, 'utf8').split('\n');
		expect(lines).toContain('node_modules/');
		for (const file of [
			'.taskgraph/state.json',
			'.taskgraph/config.local.json'
		]) {
			expect(lines.filter((line) => line === file)).toHaveLength(1);
		}
	});

	it('reads a model from config.local.json over config.json', () => {
		writeJson(localPath(), { models: { main: { modelId: 'opus' } } });

		const result = run(['models']);

		expect(result.status).toBe(0);
		expect(result.stdout).toMatch(/Main\s+opus/);
	});

	it('works with no config.local.json', () => {
		const result = run(['models']);

		expect(result.status).toBe(0);
		expect(result.stdout).toMatch(/Main\s+sonnet/);
	});

	it('saves a locally overridden model locally, leaving config.json as it was', () => {
		writeJson(localPath(), { models: { main: { modelId: 'opus' } } });
		const sharedBefore = readJson(sharedPath());

		const result = run(['models', '--set-main', 'haiku']);

		expect(result.status).toBe(0);
		expect(readJson(localPath()).models.main.modelId).toBe('haiku');
		// The whole role stays local, maxTokens included
		expect(readJson(sharedPath()).models).toEqual(sharedBefore.models);
	});

	it('saves a shared model to config.json', () => {
		const result = run(['models', '--set-main', 'opus']);

		expect(result.status).toBe(0);
		expect(readJson(sharedPath()).models.main.modelId).toBe('opus');
		expect(fs.existsSync(localPath())).toBe(false);
	});

	describe('a project whose config.json has the claude executable path', () => {
		beforeEach(() => {
			editShared((config) => {
				config.claudeCode = { pathToClaudeCodeExecutable: EXECUTABLE };
			});
		});

		it('moves it to config.local.json on the next settings change', () => {
			const result = run(['models', '--set-main', 'opus']);

			expect(result.status).toBe(0);
			const shared = readJson(sharedPath());
			expect(shared.models.main.modelId).toBe('opus');
			expect(shared.claudeCode).toBeUndefined();
			expect(readJson(localPath())).toEqual({
				claudeCode: { pathToClaudeCodeExecutable: EXECUTABLE }
			});
		});

		it('moves it when init runs again, and says so', () => {
			const result = run(['init', '--yes', '--no-aliases', '--no-git']);

			expect(result.status).toBe(0);
			expect(result.stdout).toMatch(
				/\.taskgraph\/config\.local\.json\s+this machine's settings, moved from config\.json/
			);
			expect(readJson(sharedPath()).claudeCode).toBeUndefined();
			expect(readJson(localPath())).toEqual({
				claudeCode: { pathToClaudeCodeExecutable: EXECUTABLE }
			});
			for (const line of result.stdout.split('\n')) {
				expect(line.length).toBeLessThanOrEqual(80);
			}
		});

		it('keeps a path config.local.json already has', () => {
			writeJson(localPath(), {
				claudeCode: { pathToClaudeCodeExecutable: '/usr/local/bin/claude' }
			});

			run(['init', '--yes', '--no-aliases', '--no-git']);

			expect(readJson(sharedPath()).claudeCode).toBeUndefined();
			expect(readJson(localPath())).toEqual({
				claudeCode: { pathToClaudeCodeExecutable: '/usr/local/bin/claude' }
			});
		});
	});

	it('tells you to untrack a state.json an earlier init let into Git', () => {
		git(['init', '-q']);
		git(['add', '-f', '.taskgraph/state.json']);

		const result = run(['init', '--yes', '--no-aliases', '--no-git']);

		expect(result.status).toBe(0);
		expect(result.stdout).toMatch(
			/\.taskgraph\/state\.json\s+ignored but still tracked; git rm --cached it/
		);
	});

	it('says nothing about state.json when Git does not track it', () => {
		git(['init', '-q']);

		const result = run(['init', '--yes', '--no-aliases', '--no-git']);

		expect(result.stdout).not.toContain('.taskgraph/state.json');
	});
});
