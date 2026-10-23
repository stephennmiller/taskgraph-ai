/**
 * @fileoverview Archive and restore against a real tasks.json and
 * archive.json: real FileStorage + TasksDomain on a temp dir, nothing mocked.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Task } from '../../../src/common/types/index.js';
import { FileStorage } from '../../../src/modules/storage/adapters/file-storage/file-storage.js';
import { createTask } from '../../../src/testing/task-fixtures.js';
import { type TmCore, createTmCore } from '../../../src/tm-core.js';

const OLD = '2020-01-01T00:00:00.000Z';

describe('archive', () => {
	let projectDir: string;
	let tmCore: TmCore;

	const tasksDir = () => path.join(projectDir, '.taskgraph', 'tasks');
	const readArchive = () =>
		JSON.parse(fs.readFileSync(path.join(tasksDir(), 'archive.json'), 'utf8'));
	const ids = (tasks: Task[]) => tasks.map((t) => String(t.id));

	async function setup(
		byTag: Record<string, Task[]>,
		global: Record<string, unknown> = {}
	) {
		projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-archive-'));
		fs.mkdirSync(tasksDir(), { recursive: true });
		fs.writeFileSync(
			path.join(projectDir, '.taskgraph', 'config.json'),
			JSON.stringify({ models: {}, global })
		);
		for (const [tag, tasks] of Object.entries(byTag)) {
			await new FileStorage(projectDir).saveTasks(tasks, tag);
		}
		tmCore = await createTmCore({ projectPath: projectDir });
	}

	afterEach(async () => {
		await tmCore?.close();
		fs.rmSync(projectDir, { recursive: true, force: true });
	});

	it('moves old finished tasks out and restores one by ID (round trip)', async () => {
		const original = createTask({
			id: 1,
			title: 'Schema',
			status: 'done',
			updatedAt: OLD,
			details: 'Keep me'
		});
		await setup({
			master: [
				original,
				createTask({ id: 2, title: 'Dropped', status: 'cancelled', updatedAt: OLD }),
				createTask({ id: 3, title: 'Fresh', status: 'done', updatedAt: new Date().toISOString() }),
				createTask({ id: 4, title: 'Open', updatedAt: OLD })
			]
		});

		const result = await tmCore.tasks.archive();

		expect(ids(result.tasks)).toEqual(['1', '2']);
		expect(result.olderThanDays).toBe(30);
		expect(ids((await tmCore.tasks.list()).tasks)).toEqual(['3', '4']);
		expect(ids(readArchive().master.tasks)).toEqual(['1', '2']);

		const restored = await tmCore.tasks.restore('1');

		expect(restored.task.title).toBe('Schema');
		const back = (await tmCore.tasks.list()).tasks;
		expect(ids(back)).toEqual(['1', '3', '4']);
		expect(back[0].details).toBe('Keep me');
		expect(back[0]).not.toHaveProperty('archivedAt');
		expect(ids(readArchive().master.tasks)).toEqual(['2']);
	});

	it('lists without moving anything on a dry run', async () => {
		await setup({
			master: [createTask({ id: 1, title: 'Done', status: 'done', updatedAt: OLD })]
		});

		const result = await tmCore.tasks.archive({ dryRun: true });

		expect(ids(result.tasks)).toEqual(['1']);
		expect(ids((await tmCore.tasks.list()).tasks)).toEqual(['1']);
		expect(fs.existsSync(path.join(tasksDir(), 'archive.json'))).toBe(false);
	});

	it('takes the age from global.archiveAfterDays, and --older-than overrides it', async () => {
		const tenDaysAgo = new Date(Date.now() - 10 * 86_400_000).toISOString();
		await setup(
			{ master: [createTask({ id: 1, title: 'Done', status: 'done', updatedAt: tenDaysAgo })] },
			{ archiveAfterDays: 7 }
		);

		expect(ids((await tmCore.tasks.archive({ dryRun: true })).tasks)).toEqual(['1']);
		expect(
			ids((await tmCore.tasks.archive({ dryRun: true, olderThanDays: 14 })).tasks)
		).toEqual([]);
	});

	it('makes a pending task that depends on an archived one ready in next, why, graph and claim', async () => {
		await setup({
			master: [
				createTask({ id: 1, title: 'Done', status: 'done', updatedAt: OLD }),
				createTask({ id: 2, title: 'Waiting', dependencies: ['1'] })
			]
		});
		await tmCore.tasks.archive();

		expect((await tmCore.tasks.getNext())?.id).toBe('2');
		expect((await tmCore.tasks.explainBlockers('2')).blocked).toBe(false);
		const tree = await tmCore.tasks.getDependencyTree();
		expect(JSON.stringify(tree)).not.toContain('"missing":["1"]');
		expect((await tmCore.tasks.claimNext({ claimant: 'me' }))?.task.id).toBe('2');

		// The dependency itself is kept in tasks.json
		const [task] = (await tmCore.tasks.list()).tasks;
		expect(task.dependencies).toEqual(['1']);
	});

	it('keeps each tag in its own archive section', async () => {
		await setup({
			master: [createTask({ id: 1, title: 'Master done', status: 'done', updatedAt: OLD })],
			feature: [
				createTask({ id: 1, title: 'Feature done', status: 'done', updatedAt: OLD }),
				createTask({ id: 2, title: 'Feature open' })
			]
		});

		await tmCore.tasks.archive({ tag: 'feature' });

		expect(ids((await tmCore.tasks.list({ tag: 'master' })).tasks)).toEqual(['1']);
		expect(ids((await tmCore.tasks.list({ tag: 'feature' })).tasks)).toEqual(['2']);
		expect(readArchive().feature.tasks[0].title).toBe('Feature done');
		expect(readArchive().master).toBeUndefined();

		await expect(tmCore.tasks.restore('1', { tag: 'master' })).rejects.toThrow(
			"Task 1 isn't archived in tag 'master'"
		);
		const { task } = await tmCore.tasks.restore('1', { tag: 'feature' });
		expect(task.title).toBe('Feature done');
	});

	it('refuses to restore a subtask ID', async () => {
		await setup({ master: [createTask({ id: 1, title: 'Open' })] });

		await expect(tmCore.tasks.restore('3.1')).rejects.toThrow(/subtask/);
	});

	it('keeps a change another writer saves while archiving', async () => {
		await setup({
			master: [
				createTask({ id: 1, title: 'Done', status: 'done', updatedAt: OLD }),
				createTask({ id: 2, title: 'Open' })
			]
		});

		await Promise.all([
			tmCore.tasks.archive(),
			new FileStorage(projectDir).updateTaskStatus('2', 'in-progress')
		]);

		const tasks = (await tmCore.tasks.list()).tasks;
		expect(ids(tasks)).toEqual(['2']);
		expect(tasks[0].status).toBe('in-progress');
		expect(ids(readArchive().master.tasks)).toEqual(['1']);
	});

	it('moves a tag\'s archived tasks when the tag is renamed, and drops them when it is deleted', async () => {
		await setup({
			master: [createTask({ id: 1, title: 'Main' })],
			feature: [createTask({ id: 1, title: 'Done', status: 'done', updatedAt: OLD })]
		});
		await tmCore.tasks.archive({ tag: 'feature' });
		const storage = new FileStorage(projectDir);

		await storage.renameTag('feature', 'launch');
		expect(readArchive().feature).toBeUndefined();
		expect(ids(readArchive().launch.tasks)).toEqual(['1']);

		await storage.deleteTag('launch');
		expect(readArchive().launch).toBeUndefined();
	});
	it('gives a copied tag the source\'s archive, so it never reuses an archived ID', async () => {
		await setup({
			master: [
				createTask({ id: 1, title: 'Done', status: 'done', updatedAt: OLD }),
				createTask({ id: 2, title: 'Open', dependencies: ['1'] })
			]
		});
		await tmCore.tasks.archive();
		const storage = new FileStorage(projectDir);

		await storage.copyTag('master', 'copy');
		await storage.createTag('branch', { copyFrom: 'master' });
		await storage.createTag('empty');

		expect(ids(readArchive().copy.tasks)).toEqual(['1']);
		expect(ids(readArchive().branch.tasks)).toEqual(['1']);
		expect(readArchive().empty).toBeUndefined();
		expect(String((await tmCore.tasks.getNext('copy'))?.id)).toBe('2');
	});
});
