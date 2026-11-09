/**
 * @fileoverview IDs and tags a command must refuse, against a real
 * tasks.json: a removed tag's IDs (#1095), unusable move destinations
 * (#1096), dependencies on missing tasks (#1097) and a tag switch
 * TASKGRAPH_TAG overrides (#1098)
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FileStorage } from '../../../src/modules/storage/adapters/file-storage/file-storage.js';
import { createTask } from '../../../src/testing/task-fixtures.js';
import { type TmCore, createTmCore } from '../../../src/tm-core.js';
import { seedTasks } from '../seed-tasks.js';

describe('ID and tag guards', () => {
	let projectDir: string;
	let tmCore: TmCore;

	async function setup() {
		projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-guards-'));
		const dir = path.join(projectDir, '.taskgraph');
		fs.mkdirSync(path.join(dir, 'tasks'), { recursive: true });
		fs.writeFileSync(
			path.join(dir, 'config.json'),
			JSON.stringify({ models: {}, global: {} })
		);
		await seedTasks(
			new FileStorage(projectDir),
			[1, 2, 3].map((id) => createTask({ id, title: `Task ${id}` })),
			'master'
		);
		tmCore = await createTmCore({ projectPath: projectDir });
	}

	const ids = async (tag?: string) =>
		(await tmCore.tasks.list({ tag })).tasks.map((t) => String(t.id));

	afterEach(async () => {
		vi.unstubAllEnvs();
		await tmCore?.close();
		fs.rmSync(projectDir, { recursive: true, force: true });
	});

	it("refuses a move onto a removed tag's name that would reuse its IDs (#1095)", async () => {
		await setup();
		await tmCore.tasks.copyTag('master', 'feat');
		// A GitHub issue points at (feat, 2), so the name's IDs stay retired (#1126)
		await new FileStorage(projectDir).modifyTask(
			'2',
			() => ({ metadata: { github: { issueNumber: 7 } } }),
			'feat'
		);
		await tmCore.tasks.deleteTag('feat');

		await expect(
			tmCore.tasks.moveToTag(['1'], 'master', 'feat')
		).rejects.toThrow('its tasks used IDs up to 3');

		expect(await ids('master')).toEqual(['1', '2', '3']);
		expect(await new FileStorage(projectDir).getAllTags()).toEqual(['master']);
	});

	it("numbers a move into a removed tag's recreated name above its IDs (#1095)", async () => {
		await setup();
		await tmCore.tasks.copyTag('master', 'feat');
		await tmCore.tasks.deleteTag('feat');
		await tmCore.tasks.createTag('feat');

		await tmCore.tasks.moveToTag(['1'], 'master', 'feat');

		expect(await ids('feat')).toEqual(['4']);
	});

	describe("a removed tag's name (#1126)", () => {
		const storage = () => new FileStorage(projectDir);
		const tasksFile = () =>
			path.join(projectDir, '.taskgraph', 'tasks', 'tasks.json');
		const archiveFile = () =>
			path.join(projectDir, '.taskgraph', 'tasks', 'archive.json');
		const readJson = (file: string) =>
			JSON.parse(fs.readFileSync(file, 'utf8'));
		const link = (tag: string, id: string) =>
			storage().modifyTask(
				id,
				() => ({ metadata: { github: { issueNumber: 7 } } }),
				tag
			);
		/** `tags add b` and two tasks in it */
		async function addTagB() {
			await tmCore.tasks.createTag('b');
			await storage().appendTasks(
				[1, 2].map((id) => createTask({ id, title: `B${id}` })),
				'b'
			);
		}

		it('is free again when none of its tasks ever had a GitHub issue', async () => {
			await setup();
			await addTagB();
			await tmCore.tasks.deleteTag('b');

			await tmCore.tasks.copyTag('master', 'b');

			expect(await ids('b')).toEqual(['1', '2', '3']);
			expect(readJson(archiveFile()).b.metadata.githubLinked).toBe(false);
		});

		it('stays free through a copy that is removed in turn, and for a move', async () => {
			await setup();
			await addTagB();
			await tmCore.tasks.deleteTag('b');
			await tmCore.tasks.copyTag('master', 'b');
			await tmCore.tasks.deleteTag('b');

			await tmCore.tasks.moveToTag(['1'], 'master', 'b');

			expect(await ids('b')).toEqual(['1']);
		});

		it('is free for another tag renamed onto it', async () => {
			await setup();
			await addTagB();
			await tmCore.tasks.renameTag('b', 'c');
			await tmCore.tasks.copyTag('master', 'a');

			await tmCore.tasks.renameTag('a', 'b');

			expect(await ids('b')).toEqual(['1', '2', '3']);
		});

		it('stays taken, with the renumbering commands as the hint, when a task had an issue', async () => {
			await setup();
			await addTagB();
			await link('b', '2');
			await tmCore.tasks.deleteTag('b');

			await expect(tmCore.tasks.copyTag('master', 'b')).rejects.toMatchObject({
				message: expect.stringContaining('its tasks used IDs up to 2'),
				hint: expect.stringMatching(
					/taskgraph tags add b.*taskgraph move --from <ids> --from-tag <tag> --to-tag b/
				)
			});
		});

		it('stays taken when the task that had the issue was removed before the tag', async () => {
			await setup();
			await addTagB();
			await link('b', '2');
			await storage().deleteTask('2', 'b');
			await tmCore.tasks.deleteTag('b');

			await expect(tmCore.tasks.copyTag('master', 'b')).rejects.toThrow(
				'its tasks used IDs up to 2'
			);
		});

		it('stays taken when the linked task was archived', async () => {
			await setup();
			await addTagB();
			await link('b', '2');
			await storage().modifyTask('2', () => ({ status: 'done' }), 'b');
			await tmCore.tasks.archive({ tag: 'b', olderThanDays: 0 });
			// As a file edited by hand or merged would be
			const data = readJson(tasksFile());
			data.b.metadata.githubLinked = false;
			fs.writeFileSync(tasksFile(), JSON.stringify(data));
			await tmCore.tasks.deleteTag('b');

			await expect(tmCore.tasks.copyTag('master', 'b')).rejects.toThrow(
				'its tasks used IDs up to 2'
			);
		});

		it('stays taken for a tag from before links were recorded', async () => {
			await setup();
			await addTagB();
			const data = readJson(tasksFile());
			delete data.b.metadata.githubLinked;
			fs.writeFileSync(tasksFile(), JSON.stringify(data));
			// A write by this version records nothing for it either
			await storage().deleteTask('1', 'b');
			await tmCore.tasks.deleteTag('b');

			expect(readJson(archiveFile()).b.metadata).not.toHaveProperty(
				'githubLinked'
			);
			await expect(tmCore.tasks.copyTag('master', 'b')).rejects.toThrow(
				'its tasks used IDs up to 2'
			);
		});

		it('stays taken when a later tag of the name, itself never linked, is removed too', async () => {
			await setup();
			await addTagB();
			await link('b', '2');
			await tmCore.tasks.deleteTag('b');
			// tags add, then a tag the first write creates
			await tmCore.tasks.createTag('b');
			await storage().appendTasks([createTask({ id: 1, title: 'New' })], 'b');
			await tmCore.tasks.deleteTag('b');
			await expect(tmCore.tasks.copyTag('master', 'b')).rejects.toThrow(
				'its tasks used IDs up to 3'
			);
			await storage().mutateTags((tags) => {
				tags.set('b', [createTask({ id: 9, title: 'New' })]);
				return { changed: ['b'], result: undefined };
			});
			await tmCore.tasks.deleteTag('b');

			await expect(tmCore.tasks.copyTag('master', 'b')).rejects.toThrow(
				'its tasks used IDs up to 9'
			);
		});
	});

	it.each(['0', '4.0', '99999999999999999999'])(
		'refuses to move a task to ID %s (#1096)',
		async (to) => {
			await setup();

			await expect(tmCore.tasks.move('3', to)).rejects.toMatchObject({
				message: `Can't move to ID "${to}"`,
				hint: expect.stringContaining('5.2')
			});

			expect(await ids()).toEqual(['1', '2', '3']);
		}
	);

	it.each(['77', '2.9'])(
		'refuses a new subtask that depends on missing %s (#1097)',
		async (dependencies) => {
			await setup();

			await expect(
				tmCore.tasks.addSubtask('1', { title: 'Sub', dependencies })
			).rejects.toThrow(`Task ${dependencies} not found`);

			expect((await tmCore.tasks.get('1')).task?.subtasks).toEqual([]);
		}
	);

	it('refuses tags use while TASKGRAPH_TAG names another tag, and says how to unset it (#1098)', async () => {
		vi.stubEnv('TASKGRAPH_TAG', 'pinned');
		await setup();
		await tmCore.tasks.createTag('pinned');
		await tmCore.tasks.createTag('other');

		await expect(tmCore.tasks.useTag('other')).rejects.toMatchObject({
			message: expect.stringContaining('TASKGRAPH_TAG sets the current tag'),
			hint: expect.stringContaining('Unset TASKGRAPH_TAG')
		});
		// Removing it would leave every command on a tag that's gone
		await expect(tmCore.tasks.deleteTag('pinned')).rejects.toThrow(
			`TASKGRAPH_TAG sets the current tag to "pinned", so it can't be removed`
		);
		await expect(tmCore.tasks.renameTag('pinned', 'p2')).rejects.toThrow(
			"so it can't be renamed"
		);
		// A tag the variable doesn't name is still free to go
		await tmCore.tasks.deleteTag('other');
		await expect(tmCore.tasks.useTag('pinned')).resolves.toMatchObject({
			currentTag: 'pinned'
		});
	});

	it('names TASKGRAPH_TAG when the tag it sets is missing (#1098)', async () => {
		vi.stubEnv('TASKGRAPH_TAG', 'gone');
		await setup();

		await expect(tmCore.tasks.list()).rejects.toMatchObject({
			message: `Active tag "gone" isn't in tasks.json`,
			hint: expect.stringContaining('Unset TASKGRAPH_TAG')
		});
	});
});
