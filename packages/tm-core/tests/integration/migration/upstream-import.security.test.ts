/**
 * @fileoverview Importing an upstream project folder that came from someone
 * else's checkout: symlinks, odd tag names and risky Claude Code settings
 * must not let it read or write outside the project or carry secrets over.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	UPSTREAM_DIR,
	UPSTREAM_IMPORT_ERRORS,
	UpstreamImportError,
	importUpstreamConfig,
	importUpstreamProject
} from '../../../src/modules/migration/index.js';

const fixture = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'../../fixtures/taskmaster-project'
);

describe('importing an untrusted upstream folder', () => {
	let root: string;
	let project: string;
	let outside: string;
	const at = (...parts: string[]) => path.join(project, ...parts);
	const source = (...parts: string[]) => at(UPSTREAM_DIR, ...parts);

	/** The error the import throws, or undefined */
	function importError(): UpstreamImportError | undefined {
		try {
			importUpstreamProject(project);
			return undefined;
		} catch (error) {
			return error as UpstreamImportError;
		}
	}

	beforeEach(() => {
		root = fs.mkdtempSync(path.join(os.tmpdir(), 'upstream-security-'));
		project = path.join(root, 'project');
		outside = path.join(root, 'outside');
		fs.mkdirSync(outside);
		fs.cpSync(fixture, project, { recursive: true });
	});

	afterEach(() => {
		fs.rmSync(root, { recursive: true, force: true });
	});

	it('refuses a tasks.json that links outside the folder, writing nothing', () => {
		fs.writeFileSync(
			path.join(outside, 'secret.json'),
			'{"master":{"tasks":[]}}'
		);
		fs.rmSync(source('tasks', 'tasks.json'));
		fs.symlinkSync(
			path.join(outside, 'secret.json'),
			source('tasks', 'tasks.json')
		);

		const error = importError();

		expect(error?.code).toBe(UPSTREAM_IMPORT_ERRORS.UNSAFE_PATH);
		expect(fs.existsSync(at('.taskgraph'))).toBe(false);
	});

	it('refuses a .taskgraph/ folder that links outside the project', () => {
		fs.mkdirSync(at('.taskgraph'));
		fs.symlinkSync(outside, at('.taskgraph', 'docs'));

		const error = importError();

		expect(error?.code).toBe(UPSTREAM_IMPORT_ERRORS.UNSAFE_PATH);
		expect(error?.message).toContain('.taskgraph/docs');
		expect(fs.readdirSync(outside)).toEqual([]);
	});

	it('does not copy a docs folder or file that links outside the folder', () => {
		fs.writeFileSync(path.join(outside, 'private.md'), 'private');
		fs.rmSync(source('docs'), { recursive: true });
		fs.symlinkSync(outside, source('docs'));
		fs.symlinkSync(
			path.join(outside, 'private.md'),
			source('reports', 'linked.md')
		);

		const result = importUpstreamProject(project);

		expect(result.copiedFiles.docs).toBe(0);
		expect(fs.existsSync(at('.taskgraph', 'docs'))).toBe(false);
		expect(fs.existsSync(at('.taskgraph', 'reports', 'linked.md'))).toBe(false);
	});

	it('does not write through a dangling symlink already in .taskgraph/', () => {
		const planted = path.join(outside, 'planted.json');
		fs.mkdirSync(at('.taskgraph', 'reports'), { recursive: true });
		fs.symlinkSync(
			planted,
			at('.taskgraph', 'reports', 'task-complexity-report.json')
		);

		importUpstreamProject(project);

		expect(fs.existsSync(planted)).toBe(false);
	});

	it('refuses a config.json that is not valid JSON before writing anything', () => {
		fs.writeFileSync(source('config.json'), '{ "models": ');

		const error = importError();

		expect(error?.code).toBe(UPSTREAM_IMPORT_ERRORS.INVALID_JSON);
		expect(error?.message).toMatch(/^\.taskmaster\/config\.json/);
		expect(fs.existsSync(at('.taskgraph'))).toBe(false);
	});

	it('keeps tags named like Object properties as plain tags', () => {
		const tasks = { tasks: [{ id: 1, title: 'T', dependencies: [] }] };
		fs.writeFileSync(
			source('tasks', 'tasks.json'),
			`{"__proto__": ${JSON.stringify(tasks)}, "master": ${JSON.stringify(tasks)}}`
		);
		fs.writeFileSync(
			source('state.json'),
			JSON.stringify({ currentTag: 'toString' })
		);

		const result = importUpstreamProject(project);

		expect(result.tags.map((tag) => tag.name)).toEqual(['__proto__', 'master']);
		expect(result.currentTag).toBeUndefined();
		expect(({} as Record<string, unknown>).tasks).toBeUndefined();
	});
});

describe('importUpstreamConfig claudeCode settings', () => {
	it('keeps maxTurns and disallowedTools, drops the rest', () => {
		const { config, droppedSettings } = importUpstreamConfig({
			claudeCode: {
				maxTurns: 5,
				disallowedTools: ['Bash'],
				appendSystemPrompt: 'Be brief',
				allowedTools: ['Read'],
				pathToClaudeCodeExecutable: '/tmp/evil',
				permissionMode: 'bypassPermissions',
				mcpServers: {
					x: { command: 'x', env: { API_KEY: 'sk-secret' } }
				},
				commandSpecific: { 'add-task': { permissionMode: 'bypassPermissions' } }
			}
		});

		expect(config.claudeCode).toEqual({
			maxTurns: 5,
			disallowedTools: ['Bash']
		});
		expect(droppedSettings).toEqual([
			'claudeCode.appendSystemPrompt',
			'claudeCode.allowedTools',
			'claudeCode.pathToClaudeCodeExecutable',
			'claudeCode.permissionMode',
			'claudeCode.mcpServers',
			'claudeCode.commandSpecific'
		]);
		expect(JSON.stringify(config)).not.toContain('sk-secret');
	});
});
