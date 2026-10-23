/**
 * @fileoverview Importing a Task Master project into TaskGraph, against a copy
 * of the fixture `.taskmaster/` folder in a real temp directory.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	DROPPED_NUM_TASKS_SETTING,
	UPSTREAM_IMPORT_ERRORS,
	UpstreamImportError,
	checkUpstreamImport,
	importUpstreamConfig,
	importUpstreamProject
} from '../../../src/modules/migration/index.js';
import { FileStorage } from '../../../src/modules/storage/index.js';

const fixture = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'../../fixtures/taskmaster-project'
);

/** Every file under `dir`, as paths relative to it */
function listFiles(dir: string): string[] {
	return fs
		.readdirSync(dir, { recursive: true, withFileTypes: true })
		.filter((entry) => entry.isFile())
		.map((entry) => path.relative(dir, path.join(entry.parentPath, entry.name)))
		.sort();
}

/** Every file under `dir`, keyed by relative path */
function snapshot(dir: string): Record<string, string> {
	return Object.fromEntries(
		listFiles(dir).map((file) => [
			file,
			fs.readFileSync(path.join(dir, file), 'utf8')
		])
	);
}

describe('importUpstreamProject', () => {
	let project: string;
	const at = (...parts: string[]) => path.join(project, ...parts);
	const readJson = (...parts: string[]) =>
		JSON.parse(fs.readFileSync(at(...parts), 'utf8'));

	beforeEach(() => {
		project = fs.mkdtempSync(path.join(os.tmpdir(), 'upstream-import-'));
		fs.cpSync(fixture, project, { recursive: true });
	});

	afterEach(() => {
		fs.rmSync(project, { recursive: true, force: true });
	});

	it('copies every tag with its tasks, subtasks and dependencies unchanged', () => {
		const result = importUpstreamProject(project);

		expect(readJson('.taskgraph', 'tasks', 'tasks.json')).toEqual(
			readJson('.taskmaster', 'tasks', 'tasks.json')
		);
		expect(result.tags).toEqual([
			{ name: 'master', tasks: 3 },
			{ name: 'feature-auth', tasks: 1 }
		]);
		expect(result.taskCount).toBe(4);
	});

	it('leaves tasks TaskGraph reads back by tag, dependencies intact', async () => {
		importUpstreamProject(project);
		const storage = new FileStorage(project);

		const master = await storage.loadTasks('master');
		const auth = await storage.loadTasks('feature-auth');

		expect(await storage.getAllTags()).toEqual(['master', 'feature-auth']);
		expect(master.map((task) => String(task.id))).toEqual(['1', '2', '3']);
		expect(master[2].dependencies.map(String)).toEqual(['1', '2']);
		expect(master[0].subtasks[1].dependencies?.map(String)).toEqual(['1']);
		expect(auth.map((task) => task.title)).toEqual(['Add login']);
	});

	it('copies docs, reports and templates, including nested folders', () => {
		const result = importUpstreamProject(project);

		expect(listFiles(at('.taskgraph'))).toEqual(
			expect.arrayContaining([
				'docs/prd.txt',
				'docs/research/2026-03-02_migration-tools.md',
				'reports/task-complexity-report.json',
				'reports/task-complexity-report_feature-auth.json',
				'templates/example_prd.txt'
			])
		);
		expect(result.copiedFiles).toEqual({ docs: 2, reports: 2, templates: 1 });
	});

	it('keeps files already in .taskgraph/ rather than overwriting them', () => {
		fs.mkdirSync(at('.taskgraph', 'templates'), { recursive: true });
		fs.writeFileSync(at('.taskgraph', 'templates', 'example_prd.txt'), 'ours');

		const result = importUpstreamProject(project);

		expect(
			fs.readFileSync(at('.taskgraph', 'templates', 'example_prd.txt'), 'utf8')
		).toBe('ours');
		expect(result.copiedFiles.templates).toBe(0);
	});

	it('does not copy provider settings or API keys', () => {
		const result = importUpstreamProject(project);
		const config = readJson('.taskgraph', 'config.json');
		const everything = Object.values(snapshot(at('.taskgraph'))).join('\n');

		expect(everything).not.toContain('sk-ant-');
		expect(everything).not.toMatch(/BaseURL|vertexProjectId|userId/);
		expect(everything).not.toMatch(/perplexity|anthropic"/);
		expect(result.droppedSettings).toEqual(
			expect.arrayContaining([
				'global.anthropicApiKey',
				'global.ollamaBaseURL',
				'global.vertexProjectId',
				'global.userId'
			])
		);
		expect(config.global).toMatchObject({
			projectName: 'Shop API',
			defaultSubtasks: 4,
			defaultPriority: 'high'
		});
	});

	it('leaves out the saved defaultNumTasks: 10, so parse-prd sizes the list to the PRD (#350)', () => {
		const result = importUpstreamProject(project);
		const config = readJson('.taskgraph', 'config.json');

		expect(config.global).not.toHaveProperty('defaultNumTasks');
		expect(result.droppedSettings).toContain(DROPPED_NUM_TASKS_SETTING);
	});

	it('keeps a defaultNumTasks other than 10, which the user chose', () => {
		const { config, droppedSettings } = importUpstreamConfig({
			global: { defaultNumTasks: 15 }
		});

		expect(config.global).toEqual({ defaultNumTasks: 15 });
		expect(droppedSettings).toEqual([]);
	});

	it('keeps model roles that map to Claude Code and drops the rest', () => {
		fs.mkdirSync(at('.taskgraph'));
		const defaults = {
			models: {
				main: { provider: 'claude-code', modelId: 'sonnet', maxTokens: 64000 },
				research: {
					provider: 'claude-code',
					modelId: 'sonnet',
					maxTokens: 8700
				},
				fallback: {
					provider: 'claude-code',
					modelId: 'sonnet',
					maxTokens: 64000
				}
			},
			global: { logLevel: 'info' }
		};
		fs.writeFileSync(at('.taskgraph', 'config.json'), JSON.stringify(defaults));

		const result = importUpstreamProject(project);
		const { models } = readJson('.taskgraph', 'config.json');

		expect(result.keptModels).toEqual([
			{ role: 'main', modelId: 'sonnet' },
			{ role: 'fallback', modelId: 'opus' }
		]);
		expect(result.droppedModels).toEqual([
			{ role: 'research', provider: 'perplexity', modelId: 'sonar-pro' }
		]);
		expect(models.main).toEqual(defaults.models.main);
		expect(models.research).toEqual(defaults.models.research);
		expect(models.fallback).toEqual({
			provider: 'claude-code',
			modelId: 'opus',
			maxTokens: 64000
		});
	});

	it('carries over the selected tag and branch mapping', () => {
		const result = importUpstreamProject(project);

		expect(result.currentTag).toBe('feature-auth');
		expect(readJson('.taskgraph', 'state.json')).toMatchObject({
			currentTag: 'feature-auth',
			branchTagMapping: { 'feature/auth': 'feature-auth' }
		});
	});

	it('leaves .taskmaster/ exactly as it was', () => {
		const before = snapshot(at('.taskmaster'));

		importUpstreamProject(project);

		expect(snapshot(at('.taskmaster'))).toEqual(before);
	});

	it('wraps a tasks.json from before tags as the master tag', () => {
		const legacy = { tasks: [{ id: 1, title: 'Old task', dependencies: [] }] };
		fs.writeFileSync(
			at('.taskmaster', 'tasks', 'tasks.json'),
			JSON.stringify(legacy)
		);

		const result = importUpstreamProject(project);

		expect(readJson('.taskgraph', 'tasks', 'tasks.json')).toEqual({
			master: legacy
		});
		expect(result.tags).toEqual([{ name: 'master', tasks: 1 }]);
		expect(result.currentTag).toBeUndefined();
	});

	it('imports over the empty tasks.json that init creates', () => {
		fs.mkdirSync(at('.taskgraph', 'tasks'), { recursive: true });
		fs.writeFileSync(
			at('.taskgraph', 'tasks', 'tasks.json'),
			JSON.stringify({ master: { tasks: [], metadata: {} } })
		);

		expect(importUpstreamProject(project).taskCount).toBe(4);
	});
});

describe('checkUpstreamImport', () => {
	let project: string;
	const at = (...parts: string[]) => path.join(project, ...parts);

	/** The error the check throws, or undefined */
	function checkError(): UpstreamImportError | undefined {
		try {
			checkUpstreamImport(project);
			return undefined;
		} catch (error) {
			return error as UpstreamImportError;
		}
	}

	beforeEach(() => {
		project = fs.mkdtempSync(path.join(os.tmpdir(), 'taskmaster-check-'));
		fs.cpSync(fixture, project, { recursive: true });
	});

	afterEach(() => {
		fs.rmSync(project, { recursive: true, force: true });
	});

	it('refuses when .taskgraph/ already has tasks, and writes nothing', () => {
		fs.mkdirSync(at('.taskgraph', 'tasks'), { recursive: true });
		const ours = JSON.stringify({ master: { tasks: [{ id: 1 }, { id: 2 }] } });
		fs.writeFileSync(at('.taskgraph', 'tasks', 'tasks.json'), ours);

		expect(() => importUpstreamProject(project)).toThrow(UpstreamImportError);
		const error = checkError();

		expect(error?.code).toBe(UPSTREAM_IMPORT_ERRORS.TASKGRAPH_HAS_TASKS);
		expect(error?.message).toBe(
			'.taskgraph/ already has 2 tasks; the import would replace them'
		);
		expect(error?.hint).toBe(
			'Move .taskgraph/tasks/tasks.json aside first, or keep using it'
		);
		expect(
			fs.readFileSync(at('.taskgraph', 'tasks', 'tasks.json'), 'utf8')
		).toBe(ours);
		expect(fs.existsSync(at('.taskgraph', 'docs'))).toBe(false);
	});

	it('refuses when there is no .taskmaster/ folder', () => {
		fs.rmSync(at('.taskmaster'), { recursive: true });

		const error = checkError();

		expect(error?.code).toBe(UPSTREAM_IMPORT_ERRORS.NO_UPSTREAM_PROJECT);
		expect(error?.hint).toContain('from the folder that holds .taskmaster/');
	});

	it('names the file when Task Master tasks.json is not valid JSON', () => {
		fs.writeFileSync(at('.taskmaster', 'tasks', 'tasks.json'), '{ "master": ');

		const error = checkError();

		expect(error?.code).toBe(UPSTREAM_IMPORT_ERRORS.INVALID_JSON);
		expect(error?.message).toMatch(
			/^\.taskmaster\/tasks\/tasks\.json isn't valid JSON/
		);
	});

	it('passes for a fresh project', () => {
		expect(checkError()).toBeUndefined();
	});
});
