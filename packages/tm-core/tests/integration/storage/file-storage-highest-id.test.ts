/**
 * @fileoverview A removed task's ID is never handed out again (#1040): every
 * write keeps the tag's `metadata.highestId`, and new tasks go above it
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Task } from '../../../src/common/types/index.js';
import { FileStorage } from '../../../src/modules/storage/adapters/file-storage/file-storage.js';
import { renderIssue } from '../../../src/modules/github/services/issue-renderer.js';
import { planSync } from '../../../src/modules/github/services/sync-planner.js';
import { createTask } from '../../../src/testing/task-fixtures.js';

describe('FileStorage high-water mark', () => {
	let tempDir: string;
	let tasksPath: string;
	let storage: FileStorage;

	const write = (data: unknown) =>
		fs.writeFileSync(tasksPath, JSON.stringify(data));
	const read = () => JSON.parse(fs.readFileSync(tasksPath, 'utf8'));
	const titled = (id: string, title: string): Task =>
		createTask({ id, title, description: title });

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-highest-id-'));
		tasksPath = path.join(tempDir, '.taskgraph', 'tasks', 'tasks.json');
		fs.mkdirSync(path.dirname(tasksPath), { recursive: true });
		storage = new FileStorage(tempDir);
	});

	afterEach(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it('gives a task added after a remove a new ID, in a file written before the mark existed', async () => {
		write({
			master: {
				tasks: [titled('1', 'A'), titled('2', 'Old feature')],
				metadata: {}
			}
		});

		await storage.deleteTask('2', 'master');
		const [added] = await storage.appendTasks(
			[titled('2', 'Brand new work')],
			'master'
		);

		expect(added.id).toBe('3');
		expect(read().master.metadata.highestId).toBe(3);
	});

	it('keeps the mark in a legacy-shaped file', async () => {
		write({ tasks: [titled('1', 'A'), titled('2', 'B')] });

		await storage.deleteTask('2', 'master');

		expect(read().metadata.highestId).toBe(2);
	});

	it("doesn't push the new task onto the removed task's GitHub issue", async () => {
		write({
			master: { tasks: [titled('1', 'A'), titled('12', 'Old feature')] }
		});
		const old = renderIssue(
			{ ...titled('12', 'Old feature'), status: 'done' },
			{ tag: 'master' }
		);

		await storage.deleteTask('12', 'master');
		const [added] = await storage.appendTasks(
			[titled('12', 'Brand new thing')],
			'master'
		);
		const plan = planSync({
			repo: 'o/r',
			tasks: [{ tag: 'master', task: added }],
			remote: [
				{
					number: 40,
					url: 'u',
					title: old.title,
					body: old.body,
					labels: old.labels,
					assignees: [],
					state: 'closed',
					stateReason: 'completed',
					author: 'me'
				}
			],
			viewer: 'me'
		} as any);

		expect(added.id).toBe('13');
		expect(plan.steps[0].action).toBe('create');
	});
});

describe('FileStorage tag delete and rename keep used IDs (#1064)', () => {
	let tempDir: string;
	let storage: FileStorage;
	const reportOf = (tag: string) =>
		path.join(
			tempDir,
			'.taskgraph',
			'reports',
			`task-complexity-report_${tag}.json`
		);
	const titled = (id: string) => createTask({ id, title: `T${id}` });

	beforeEach(async () => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-tag-ids-'));
		fs.mkdirSync(path.join(tempDir, '.taskgraph', 'tasks'), {
			recursive: true
		});
		fs.mkdirSync(path.dirname(reportOf('other')), { recursive: true });
		storage = new FileStorage(tempDir);
		await storage.appendTasks([titled('1')], 'master');
		await storage.createTag('other');
		await storage.appendTasks(
			['1', '2', '3', '4'].map((id) => titled(id)),
			'other'
		);
		fs.writeFileSync(reportOf('other'), '{"complexityAnalysis":[]}');
	});

	afterEach(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it('numbers a recreated tag above the deleted one, and drops its complexity report', async () => {
		await storage.deleteTag('other');
		await storage.createTag('other');
		const [added] = await storage.appendTasks([titled('1')], 'other');

		expect(added.id).toBe('5');
		expect(fs.existsSync(reportOf('other'))).toBe(false);
	});

	it('numbers a tag created under a renamed tag’s old name above it, and moves the report', async () => {
		await storage.renameTag('other', 'renamed');
		await storage.createTag('other');
		const [added] = await storage.appendTasks([titled('1')], 'other');
		const [inRenamed] = await storage.appendTasks([titled('1')], 'renamed');

		expect(added.id).toBe('5');
		expect(inRenamed.id).toBe('5');
		expect(fs.existsSync(reportOf('other'))).toBe(false);
		expect(fs.existsSync(reportOf('renamed'))).toBe(true);
	});

	// A committed link at .taskgraph/reports sent the delete and the rename
	// to a file outside the project (#1123)
	it.skipIf(process.platform === 'win32')(
		'refuses to delete or move a report through a symlinked reports folder',
		async () => {
			const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-out-'));
			const reports = path.dirname(reportOf('other'));
			fs.renameSync(reportOf('other'), path.join(elsewhere, 'kept.json'));
			fs.writeFileSync(
				path.join(elsewhere, path.basename(reportOf('other'))),
				'{}'
			);
			fs.rmdirSync(reports);
			fs.symlinkSync(elsewhere, reports);

			await expect(storage.renameTag('other', 'renamed')).rejects.toThrow(
				/symlink/
			);
			await expect(storage.deleteTag('other')).rejects.toThrow(/symlink/);

			expect(fs.readdirSync(elsewhere).sort()).toEqual([
				'kept.json',
				'task-complexity-report_other.json'
			]);
			// Refused before the tag changed: a command that fails leaves it as it was
			expect(await storage.getAllTags()).toContain('other');
			expect(await storage.getAllTags()).not.toContain('renamed');
			fs.rmSync(elsewhere, { recursive: true, force: true });
		}
	);

	it('refuses a copy or rename onto a removed tag’s name that would reuse its IDs', async () => {
		await storage.deleteTag('other');

		await expect(storage.copyTag('master', 'other')).rejects.toThrow(
			/used IDs up to 4/
		);
		await expect(
			storage.createTag('other', { copyFrom: 'master' })
		).rejects.toThrow(/used IDs up to 4/);
		await expect(storage.renameTag('master', 'other')).rejects.toThrow(
			/used IDs up to 4/
		);
		expect(await storage.getAllTags()).toEqual(['master']);
	});

	it('lets a renamed tag be renamed back, but not another tag onto its old name', async () => {
		await storage.renameTag('other', 'renamed');
		await expect(storage.renameTag('master', 'other')).rejects.toThrow(
			/used IDs up to 4/
		);

		await storage.renameTag('renamed', 'other');

		expect((await storage.loadTasks('other')).map((t) => t.id)).toEqual([
			'1',
			'2',
			'3',
			'4'
		]);
	});
});
